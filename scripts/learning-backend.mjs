import {readFile} from 'node:fs/promises';
import {runUsageQuery} from './usage-deploy-query.mjs';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing criteria-backend environment.');
await runUsageQuery(await readFile('supabase/migrations/20260916210000_feedback_learning.sql','utf8'),{token,ref,mode:'prepare'});
console.log('Private feedback learning capture and gated model registry installed. No training job was started.');
