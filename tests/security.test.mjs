import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sensitiveFindings, auditFiles } from '../scripts/audit-public.mjs';

test('public-source audit detects private credentials and reports no credential values',async()=>{
 const token='ghp_'+'a'.repeat(36),pem=['-----BEGIN','PRIVATE KEY-----'].join(' ');
 const source=`const token='${token}';\n${pem}`;
 const findings=sensitiveFindings('src/unsafe.js',source);
 assert.deepEqual(findings.map(f=>f.kind).sort(),['private key','provider secret']);assert.ok(!JSON.stringify(findings).includes(token));
 const root=await mkdtemp(path.join(os.tmpdir(),'wallet-audit-'));
 try{await writeFile(path.join(root,'unsafe.js'),source);await assert.rejects(auditFiles(root,['unsafe.js']),error=>error.message.includes('unsafe.js:1') && !error.message.includes(token) && !error.message.includes(pem));}
 finally{await rm(root,{recursive:true,force:true});}
});
test('public Firebase browser keys are allowed only in the intended public config',()=>{
 const key='AIza'+'a'.repeat(35),source=`export const config={apiKey:'${key}'}`;
 assert.deepEqual(sensitiveFindings('src/firebase-config.js',source),[]);assert.equal(sensitiveFindings('src/other.js',source)[0].kind,'unexpected Google API key');
 assert.equal(sensitiveFindings('src/firebase-config.js',JSON.stringify({type:'service'+'_account'}))[0].kind,'service account');
});
test('private mailboxes and personal sheet URLs are blocked while synthetic examples and GitHub noreply are allowed',()=>{
 const mailbox=['person','mail.invalid'].join('@'),sheet='https://docs.google.com/spreadsheets/d/'+'a'.repeat(44);
 assert.deepEqual(sensitiveFindings('README.md',mailbox+'\n'+sheet).map(f=>f.kind),['email address','personal spreadsheet link']);
 assert.deepEqual(sensitiveFindings('tests/example.js','alice@example.test author@users.noreply.github.com'),[]);
 assert.deepEqual(sensitiveFindings('tests/example.js',"const response={access_token:'browser-test-only'}"),[]);
 assert.equal(sensitiveFindings('src/unsafe.js',"const response={access_token:'browser-test-only'}")[0].kind,'literal credential');
});
test('credential files and financial exports cannot pass an audit even with innocuous contents',()=>{
 for(const file of ['.env','.env.production','.npmrc','credentials.json','secrets/service-account.json','config/firebase-adminsdk-credentials.json','private.pem','dear-wallet-2026-11-09.json','exports/records.json'])assert.equal(sensitiveFindings(file,'{}')[0].kind,'private file',file);
});
