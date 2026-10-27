import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderContent} from '../src/rich-text';
test('table headers, arbitrary columns, rows and following text',()=>{
 const html=renderContent('| a | b | c |\n|---|---|---|\n| A | B | C |\n| D | E | F |\n終了\n**太字**');
 assert.equal((html.match(/<th scope/g)??[]).length,3);assert.equal((html.match(/<td>/g)??[]).length,6);
 assert.ok(html.includes('<td>A</td><td>B</td><td>C</td>'));assert.ok(html.endsWith('終了\n<strong>太字</strong>'));
});
test('plain text, malformed tables and unmatched bold remain text',()=>{
 assert.equal(renderContent('通常\n**未完\n| a | b |\n|--|---|'),'通常\n**未完\n| a | b |\n|--|---|');
});
test('empty/missing/extra cells preserve data and cell bold is rendered',()=>{
 const html=renderContent('| a | b |\r\n|---|---|\r\n| **強調** | | extra |\r\n| only |');
 assert.ok(html.includes('<td><strong>強調</strong></td><td></td><td>extra</td>'));
 assert.ok(html.includes('<td>only</td><td></td><td></td>'));
});
test('HTML is escaped inside normal text, bold and tables',()=>{
 const html=renderContent('**<img src=x onerror=alert(1)>**\n| <script> |\n|---|\n| & value |');
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&amp; value'));
});
