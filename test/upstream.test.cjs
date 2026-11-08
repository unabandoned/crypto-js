// Runs upstream's YUI test suite (test/*-test.js) on node:test, against the
// built package rather than src/, so it checks what actually ships.
//
// Upstream only ever ran these in a browser (test/test.html, loading YUI
// 3.5.1 from a CDN that no longer exists). This is the small slice of YUI the
// suite uses: YUI.add, Y.Test.Case/Runner.add with setUp/tearDown, and
// Y.Assert.areEqual/areNotEqual (loose, as in YUI)/isTrue/isFalse.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cases = [];

const Y = {
    Test: {
        Case: function (definition) {
            Object.assign(this, definition);
        },
        Runner: {
            add: (testCase) => cases.push(testCase)
        }
    },
    Assert: {
        // YUI's areEqual/areNotEqual compare with == / !=, not strictly.
        areEqual: (expected, actual) => assert.ok(expected == actual, `expected ${expected}, got ${actual}`),
        areNotEqual: (unexpected, actual) => assert.ok(unexpected != actual, `did not expect ${actual}`),
        isTrue: (value) => assert.strictEqual(value, true),
        isFalse: (value) => assert.strictEqual(value, false)
    }
};

global.CryptoJS = require(path.join(root, 'index.js'));
global.YUI = { add: (name, fn) => fn(Y) };

const files = fs.readdirSync(__dirname).filter((file) => file.endsWith('-test.js')).sort();
for (const file of files) {
    require(path.join(__dirname, file));
}

test('the upstream suite was loaded', () => {
    assert.ok(files.length >= 40, `only ${files.length} upstream test files found`);
});

for (const testCase of cases) {
    test(testCase.name, async (t) => {
        const names = Object.keys(testCase).filter((key) => /^test/.test(key) && typeof testCase[key] === 'function');
        assert.ok(names.length > 0, `${testCase.name} has no tests`);
        for (const name of names) {
            await t.test(name, () => {
                if (testCase.setUp) {
                    testCase.setUp();
                }
                try {
                    testCase[name]();
                } finally {
                    if (testCase.tearDown) {
                        testCase.tearDown();
                    }
                }
            });
        }
    });
}
