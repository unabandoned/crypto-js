// Builds the published CommonJS/AMD/global modules from src/.
//
// This replaces upstream's grunt + fmd ("Factory Module Definition") build,
// whose dev tree no longer installs on current npm. It is a dependency-free
// port of exactly what fmd 0.0.3 did with upstream's options (factories
// commonjs/amd/global, trim_whitespace, unix new lines, tab indent), so the
// files it writes are byte-for-byte the files in the crypto-js 4.2.0 tarball;
// test/build.test.mjs holds it to that.
//
// Usage: node scripts/build.mjs [outDir]   (default: the package root)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = createRequire(import.meta.url)('./modules.cjs');
const srcDir = join(root, 'src');

const INDENT = '\t';

const uniq = (list) => [...new Set(list)];
const rtrim = (code) => code.replace(/[\t ]+(\r\n|\r|\n|$)/g, '$1');
const addIndent = (code) => code.replace(/(^|\r\n|\r|\n)/g, '$1' + INDENT);
const fixNewline = (code) => code.replace(/(\r\n|\r|\n)/g, '\n');
const property = (name) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? '.' + name : '[' + JSON.stringify(name) + ']';
const source = (name) => join(srcDir, name + '.js');

// Resolve each module's source files and dependencies, as upstream's
// grunt/tasks/modularize.js did before handing them to fmd.
function plan(name, conf) {
    const sources = [];
    const requires = [];
    const args = [];

    if (existsSync(source(name))) {
        sources.push(source(name));
    }

    if (conf.pack) {
        // A pack concatenates every component into one self-contained file.
        // The comparator is upstream's, kept as is (including its reliance on
        // Array.prototype.sort) so the concatenation order stays the same.
        const deps = uniq(conf.components.flatMap((dep) => modules[dep].components))
            .filter((dep) => dep !== name)
            .sort((a, b) => {
                if (modules[a].components.includes(b)) {
                    return 1;
                }
                if (modules[b].components.includes(a)) {
                    return -1;
                }
                return 0;
            });

        for (const dep of deps) {
            if (existsSync(source(dep))) {
                sources.push(source(dep));
            }
        }
    } else {
        // core is passed in as the CryptoJS argument; the rest are loaded for
        // their side effects on it. fmd puts argument-bearing deps first.
        for (const dep of conf.components.filter((c) => c !== name)) {
            if (dep === 'core') {
                requires.unshift('./' + dep);
                args.unshift('CryptoJS');
            } else {
                requires.push('./' + dep);
            }
        }
    }

    return { sources: uniq(sources), requires, args };
}

function wrap(name, conf) {
    const { sources, requires, args } = plan(name, conf);
    const sourceScript = sources.map((file) => readFileSync(file).toString()).join('\n\n');

    // Browser globals: only modules that declare one (core, index, crypto-js)
    // are passed as root.<global>; trailing deps without one are dropped.
    let undef = false;
    let lastGlobal = 0;
    const globals = requires.map((req, i) => {
        const dep = modules[req.replace(/^\.\//, '')];
        if (dep.global) {
            lastGlobal = i + 1;
            return 'root' + property(dep.global);
        }
        undef = true;
        return 'undef';
    }).slice(0, lastGlobal);
    const assign = conf.global ? 'root' + property(conf.global) + ' = ' : '';

    const defines = [
        'if (typeof exports === "object") {\n' +
            addIndent('// CommonJS\nmodule.exports = exports = factory(' +
                requires.map((req) => 'require("' + req + '")').join(', ') + ');') + '\n}',
        'if (typeof define === "function" && define.amd) {\n' +
            addIndent('// AMD\ndefine([' + requires.map((req) => '"' + req + '"').join(', ') +
                '], factory);') + '\n}',
        '{\n' + addIndent('// Global (browser)\n' + assign + 'factory(' + globals.join(', ') + ');') + '\n}'
    ];

    let content = ';(function (root, factory' + (undef ? ', undef' : '') + ') {\n';
    content += rtrim(addIndent(defines.join('\nelse ')));
    content += '\n}(this, function (' + args.join(', ') + ') {';
    content += rtrim(sourceScript ? addIndent('\n\n' + sourceScript) : '');
    content += rtrim(conf.exports ? addIndent('\n\nreturn ' + conf.exports + ';') : '');
    content += '\n\n}));';

    return rtrim(fixNewline(content));
}

export function build(outDir = root) {
    mkdirSync(outDir, { recursive: true });
    const written = [];
    for (const [name, conf] of Object.entries(modules)) {
        writeFileSync(join(outDir, name + '.js'), wrap(name, conf));
        written.push(name + '.js');
    }
    return written;
}

export const outputs = Object.keys(modules).map((name) => name + '.js');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const outDir = process.argv[2] ? resolve(process.argv[2]) : root;
    const written = build(outDir);
    console.log(`Built ${written.length} modules into ${outDir}`);
}
