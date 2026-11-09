import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root=fileURLToPath(new URL('../',import.meta.url));
const patterns=[
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['service account',/"type"\s*:\s*"service_account"/g],
  ['provider secret',/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16})\b/g],
  ['literal credential',/\b(?:client_secret|refresh_token|access_token|password|private_key)\s*["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi],
  ['email address',/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g],
  ['personal spreadsheet link',/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{25,})/g],
  ['unexpected Google API key',/\bAIza[0-9A-Za-z_-]{30,}\b/g],
];

// Report locations and kinds only. Never echo a discovered value to CI logs.
export function sensitiveFindings(filename,source){
  const name=filename.replaceAll('\\','/'),findings=[];
  if(/(?:^|\/)(?:\.env(?:\..+)?|\.npmrc|\.netrc|\.git-credentials|(?:credentials(?:-.*)?|tokens?|.*service[-_]account.*|.*firebase-adminsdk.*)\.json)$|\.(?:pem|key|p12|pfx)$|^dear-wallet-\d{4}-\d{2}-\d{2}.*\.json$|^(?:exports|backups)\//i.test(name))findings.push({file:name,line:1,kind:'private file'});
  for(const [kind,pattern] of patterns){
    pattern.lastIndex=0;
    for(const match of source.matchAll(pattern)){
      const value=match[1] || match[0];
      if(kind==='email address' && /@(?:example\.(?:test|com|org|net)|(?:[A-Za-z0-9-]+\.)?users\.noreply\.github\.com)$/i.test(value))continue;
      if(kind==='unexpected Google API key' && name==='src/firebase-config.js')continue;
      if(kind==='literal credential' && name.startsWith('tests/') && /^(?:test-|fake-|mock-)|-test-only$/.test(value))continue;
      if(kind==='personal spreadsheet link' && /^(?:test-sheet-|YOUR_|EXAMPLE_)/.test(value))continue;
      findings.push({file:name,line:source.slice(0,match.index).split('\n').length,kind});
    }
  }
  return findings;
}

export async function auditFiles(base,files){
  const findings=[];
  for(const file of new Set(files))findings.push(...sensitiveFindings(file,await readFile(path.join(base,file),'utf8')));
  if(findings.length){
    const locations=findings.map(({file,line,kind})=>`${file}:${line}: ${kind}`).join('\n');
    throw new Error(`Public-source audit failed. Remove private data before publishing.\n${locations}`);
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {stdout}=await promisify(execFile)('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'});
    const files=stdout.split('\0').filter(Boolean);
    await auditFiles(root,files);console.log(`Public-source audit passed (${files.length} files; values are never logged).`);
  }catch(error){console.error(error.code?`Unable to enumerate source files (${error.code}).`:error.message);process.exitCode=1;}
}
