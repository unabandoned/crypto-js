// Holds the build to the published crypto-js 4.2.0 package: same files, same
// bytes, same module shapes. If a deliberate change to src/ moves a hash,
// regenerate test/fixtures/crypto-js-4.2.0.sha256 in the same PR and say why.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { build, outputs } from '../scripts/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const modules = require('../scripts/modules.cjs');

const golden = new Map(
    readFileSync(join(root, 'test/fixtures/crypto-js-4.2.0.sha256'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split(/\s+/).reverse())
);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('the build writes exactly the modules crypto-js 4.2.0 shipped, byte for byte', () => {
    const out = mkdtempSync(join(tmpdir(), 'crypto-js-build-'));
    try {
        const written = build(out).sort();
        assert.deepEqual(written, [...golden.keys()].sort());
        for (const file of written) {
            assert.equal(sha256(join(out, file)), golden.get(file), `${file} differs from crypto-js 4.2.0`);
        }
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
});

test('every module loads from the package root and returns its export (require)', () => {
    const CryptoJS = require(join(root, 'index.js'));
    for (const [name, conf] of Object.entries(modules)) {
        const exported = require(join(root, name + '.js'));
        if (name === 'crypto-js') {
            // The pack is self-contained, so it is its own CryptoJS instance.
            assert.equal(typeof exported.AES.encrypt, 'function');
            continue;
        }
        if (!conf.exports) {
            // hmac and cipher-core only extend CryptoJS; upstream returns nothing.
            assert.equal(exported, undefined, `${name}.js should not export anything`);
            continue;
        }
        const expected = conf.exports.split('.').slice(1).reduce((obj, key) => obj[key], CryptoJS);
        if (name === 'pad-ansix923') {
            // Upstream bug, kept for compatibility: the module table exports
            // CryptoJS.pad.Ansix923 but src/ defines CryptoJS.pad.AnsiX923, so
            // require('crypto-js/pad-ansix923') has always returned undefined.
            assert.equal(exported, undefined);
            assert.equal(typeof CryptoJS.pad.AnsiX923.pad, 'function');
            continue;
        }
        assert.ok(expected !== undefined, `${conf.exports} is undefined`);
        assert.equal(exported, expected, `${name}.js does not return ${conf.exports}`);
    }
});

test('ESM default imports work the way CyberChef uses them', async () => {
    const { default: CryptoJS } = await import(pathToFileURL(join(root, 'index.js')));
    const { default: Hex } = await import(pathToFileURL(join(root, 'enc-hex.js')));
    const { default: AES } = await import(pathToFileURL(join(root, 'aes.js')));
    assert.equal(Hex, CryptoJS.enc.Hex);
    assert.equal(AES, CryptoJS.AES);

    const key = Hex.parse('000102030405060708090a0b0c0d0e0f');
    const ciphertext = CryptoJS.RC4.encrypt(Hex.parse('00000000000000000000'), key).ciphertext.toString();
    assert.equal(CryptoJS.RC4.decrypt({ ciphertext: Hex.parse(ciphertext) }, key).toString(), '00000000000000000000');
    assert.equal(
        CryptoJS.EvpKDF('password', Hex.parse('0011223344556677'), { keySize: 4, iterations: 1, hasher: CryptoJS.algo.MD5 }).toString().length,
        32
    );
});

test('browser globals: core.js defines CryptoJS and per-algorithm files attach to it', () => {
    const context = vm.createContext({});
    vm.runInContext(readFileSync(join(root, 'core.js'), 'utf8'), context);
    for (const dep of modules.sha256.components.filter((c) => c !== 'core').concat('sha256')) {
        vm.runInContext(readFileSync(join(root, dep + '.js'), 'utf8'), context);
    }
    assert.equal(
        vm.runInContext('CryptoJS.SHA256("abc").toString()', context),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );

    const packed = vm.createContext({});
    vm.runInContext(readFileSync(join(root, 'crypto-js.js'), 'utf8'), packed);
    assert.equal(vm.runInContext('CryptoJS.MD5("abc").toString()', packed), '900150983cd24fb0d6963f7d28e17f72');
});

test('AMD: modules define themselves with relative dependencies', () => {
    const defined = [];
    const context = vm.createContext({ define: Object.assign((deps, factory) => defined.push({ deps, factory }), { amd: true }) });
    vm.runInContext(readFileSync(join(root, 'aes.js'), 'utf8'), context);
    assert.deepEqual([...defined[0].deps], ['./core', './enc-base64', './md5', './evpkdf', './cipher-core']);
});

test('the npm tarball ships every module, the docs and nothing from the build tooling', () => {
    const report = JSON.parse(
        execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })
    );
    // npm 10 reports an array, npm 11+ an object keyed by package name.
    const pack = Array.isArray(report) ? report[0] : Object.values(report)[0];
    const files = pack.files.map((f) => f.path).sort();
    const expected = [...outputs, 'LICENSE', 'README.md', 'CONTRIBUTING.md', 'package.json', 'docs/QuickStartGuide.wiki'].sort();
    assert.deepEqual(files, expected);
});
