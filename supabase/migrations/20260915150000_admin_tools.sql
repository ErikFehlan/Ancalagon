-- Technical resources are served only after the existing application-admin check.
create table if not exists public.admin_tool_resources (
  resource_key text primary key,
  body text not null
);
alter table public.admin_tool_resources enable row level security;
revoke all on public.admin_tool_resources from public, anon, authenticated;

create or replace function public.get_admin_tools()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_app_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return jsonb_build_object('html', (select body from public.admin_tool_resources where resource_key = 'panel'));
end;
$$;
revoke all on function public.get_admin_tools() from public, anon;
grant execute on function public.get_admin_tools() to authenticated;

create or replace function public.get_admin_starter_file(
  p_file text, p_model text default 'gpt-4.1-mini', p_project text default 'ancalagon-backend'
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  result_name text; result_type text; result_body text;
  model text := coalesce(p_model, 'gpt-4.1-mini');
  project text := coalesce(p_project, 'ancalagon-backend');
begin
  -- Check the role before looking up files or validating supplied parameters.
  if auth.uid() is null or not public.is_app_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if model !~ '^[A-Za-z0-9._:-]{1,100}$' or project !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'Use a valid model and lowercase project name' using errcode = '22023';
  end if;
  result_name := case p_file when 'server' then 'server.ts' when 'schema' then 'schema.sql'
    when 'prompt' then 'evaluation-prompt.txt' when 'pkg' then 'package.json' when 'env' then '.env.example' end;
  if result_name is null then raise exception 'Unknown starter file' using errcode = '22023'; end if;
  result_type := case p_file when 'pkg' then 'application/json' when 'schema' then 'application/sql' else 'text/plain' end;
  select body into strict result_body from public.admin_tool_resources where resource_key = p_file;
  result_body := replace(replace(result_body, '__ANCALAGON_MODEL__', model), '__ANCALAGON_PROJECT__', project);
  return jsonb_build_object('name', result_name, 'type', result_type, 'content', result_body);
end;
$$;
revoke all on function public.get_admin_starter_file(text,text,text) from public, anon;
grant execute on function public.get_admin_starter_file(text,text,text) to authenticated;

comment on table public.admin_tool_resources is 'Deployment-owned setup resources. No direct client access; admin-checked RPCs only.';

-- Preserve the five setup sections and their existing starter downloads.
insert into public.admin_tool_resources(resource_key,body) values
('panel', $resource$        <div class="rf-grid rf-two">
          <div class="rf-card"><h3>1. Hybrid Engine Connection</h3><div class="rf-form"><div><label for="patternFunctionUrl">Supabase function URL</label><input id="patternFunctionUrl" type="url" placeholder="https://PROJECT.supabase.co/functions/v1/analyze-patterns"></div><div><label for="patternAnonKey">Supabase anon key</label><input id="patternAnonKey" type="password" autocomplete="off" placeholder="Public anon/publishable key"></div><button class="rf-btn primary" id="saveHybridSettings" type="button">Save Connection</button><div class="rf-note">This connection override applies to your current session. Server secrets are managed in Supabase.</div><hr style="border:0;border-top:1px solid #26384e;width:100%"><div><label for="backendProject">Project name</label><input id="backendProject" value="ancalagon-backend"></div><div><label for="backendModel">OpenAI model</label><input id="backendModel" value="gpt-4.1-mini"></div></div></div>
          <div class="rf-card"><h3>2. Starter Files</h3><div class="rf-list"><button class="rf-btn" id="downloadServer">Download server.ts</button><button class="rf-btn" id="downloadSchema">Download schema.sql</button><button class="rf-btn" id="downloadPrompt">Download evaluation-prompt.txt</button><button class="rf-btn" id="downloadPackage">Download package.json</button><button class="rf-btn" id="downloadEnv">Download .env.example</button></div></div>
        </div>
        <div class="rf-card" style="margin-top:16px"><h3>3. What the backend will do</h3><div class="rf-priorities"><div class="rf-priority"><span class="rf-check">✓</span><span>Accept PDF, DOCX, or text resumes</span></div><div class="rf-priority"><span class="rf-check">✓</span><span>Extract resume text server-side</span></div><div class="rf-priority"><span class="rf-check">✓</span><span>Score against the active job, approved benchmarks, and manager feedback</span></div><div class="rf-priority"><span class="rf-check">✓</span><span>Return structured JSON with strengths, concerns, and questions</span></div><div class="rf-priority"><span class="rf-check">✓</span><span>Persist candidates and evaluations in Postgres</span></div><div class="rf-priority"><span class="rf-check">✓</span><span>Expose MCP tools so ChatGPT and this dashboard use the same data</span></div></div></div>
        <div class="rf-card" style="margin-top:16px"><h3>4. MCP Tools</h3><div class="rf-tablewrap"><table class="rf-table"><thead><tr><th>Tool</th><th>Purpose</th></tr></thead><tbody><tr><td><strong>analyze_resume</strong></td><td>Parse and score a resume against the calibrated rubric.</td></tr><tr><td><strong>analyze_portfolio</strong></td><td>Review a portfolio and update candidate fit.</td></tr><tr><td><strong>create_candidate</strong></td><td>Persist a new candidate profile.</td></tr><tr><td><strong>list_candidates</strong></td><td>Load candidates into the dashboard.</td></tr><tr><td><strong>save_manager_feedback</strong></td><td>Store manager feedback as future scoring context.</td></tr><tr><td><strong>recalculate_candidate</strong></td><td>Re-score when new portfolio or manager data arrives.</td></tr></tbody></table></div></div>
        <div class="rf-card" style="margin-top:16px"><div class="rf-cardhead"><h3>5. Deployment Checklist</h3><span class="rf-pill rf-blue">Next step</span></div><ol style="padding-left:20px;margin:0;display:grid;gap:9px;font-size:13px;line-height:1.5"><li>Create a Postgres database (Supabase works well).</li><li>Run the generated <strong>schema.sql</strong>.</li><li>Create the backend project and add the generated files.</li><li>Add your <strong>OPENAI_API_KEY</strong> and <strong>DATABASE_URL</strong> to the real environment.</li><li>Run <strong>npm install</strong>, then <strong>npm run dev</strong>.</li><li>Expose the MCP endpoint over HTTPS and connect it to ChatGPT Developer Mode.</li><li>Replace the prototype's local scoring call with the real <strong>analyze_resume</strong> tool.</li></ol></div>$resource$),
('pkg', $resource${
  "name": "__ANCALAGON_PROJECT__",
  "private": true,
  "type": "module",
  "scripts": {"dev": "tsx watch src/server.ts", "start": "tsx src/server.ts"},
  "dependencies": {"@modelcontextprotocol/sdk": "latest", "openai": "latest", "pg": "latest", "express": "latest", "multer": "latest", "mammoth": "latest", "pdf-parse": "latest", "zod": "latest"},
  "devDependencies": {"tsx": "latest", "typescript": "latest", "@types/express": "latest", "@types/multer": "latest"}
}$resource$),
('env', $resource$OPENAI_API_KEY=your_openai_api_key
DATABASE_URL=postgresql://user:password@host:5432/resume_fit
PORT=3000
OPENAI_MODEL=__ANCALAGON_MODEL__
$resource$),
('schema', $resource$create extension if not exists pgcrypto;

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  portfolio_url text,
  linkedin_url text,
  resume_text text,
  score numeric(3,1),
  recommendation text,
  primary_signal text,
  strengths jsonb default '[]'::jsonb,
  concerns jsonb default '[]'::jsonb,
  screening_questions jsonb default '[]'::jsonb,
  criteria jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists manager_feedback (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete cascade,
  feedback_type text not null,
  feedback_text text not null,
  created_at timestamptz default now()
);
$resource$),
('prompt', $resource$Evaluate the candidate only against the supplied job description, evaluation criteria, knockout requirements, manager feedback, and active benchmark evidence. Score only claims supported by the resume or portfolio. Do not infer protected characteristics or use them in the assessment. Explain strengths, concerns, and evidence gaps. Return strict JSON with: name, title, score (0-10), recommendation, criteria object, strengths[], concerns[], primary_signal, screening_questions[].$resource$),
('server', $resource$import express from 'express';
import multer from 'multer';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import OpenAI from 'openai';
import pg from 'pg';
import { z } from 'zod';

const app=express();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024}});
const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const model=process.env.OPENAI_MODEL||'__ANCALAGON_MODEL__';

const Evaluation=z.object({name:z.string(),title:z.string().nullable().optional(),score:z.number().min(0).max(10),recommendation:z.string(),criteria:z.record(z.number()),strengths:z.array(z.string()),concerns:z.array(z.string()),primary_signal:z.string(),screening_questions:z.array(z.string())});

async function extractResume(file:any){
  const name=(file.originalname||'').toLowerCase();
  if(name.endsWith('.pdf')) return (await pdf(file.buffer)).text;
  if(name.endsWith('.docx')) return (await mammoth.extractRawText({buffer:file.buffer})).value;
  return file.buffer.toString('utf8');
}

async function evaluateResume(resumeText:string){
  const prompt=`Evaluate the candidate only against the supplied job description, evaluation criteria, knockout requirements, manager feedback, and active benchmark evidence. Score only claims supported by the resume or portfolio. Do not infer protected characteristics or use them in the assessment. Explain strengths, concerns, and evidence gaps. Return strict JSON with: name, title, score (0-10), recommendation, criteria object, strengths[], concerns[], primary_signal, screening_questions[].`;
  const response=await openai.responses.create({model,input:[{role:'system',content:prompt},{role:'user',content:'RESUME\n'+resumeText}],text:{format:{type:'json_object'}}});
  return Evaluation.parse(JSON.parse(response.output_text));
}

app.post('/api/analyze-resume',upload.single('resume'),async(req,res)=>{
  try{if(!req.file)return res.status(400).json({error:'resume file required'});const text=await extractResume(req.file);const evaluation=await evaluateResume(text);const q=await db.query('insert into candidates(name,title,resume_text,score,recommendation,primary_signal,strengths,concerns,screening_questions,criteria) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',[evaluation.name,evaluation.title||null,text,evaluation.score,evaluation.recommendation,evaluation.primary_signal,JSON.stringify(evaluation.strengths),JSON.stringify(evaluation.concerns),JSON.stringify(evaluation.screening_questions),JSON.stringify(evaluation.criteria)]);res.json(q.rows[0]);}catch(err:any){res.status(500).json({error:err.message||'analysis failed'});}
});

app.get('/api/candidates',async(_req,res)=>{const q=await db.query('select * from candidates order by score desc nulls last, created_at desc');res.json(q.rows)});
app.post('/api/feedback',express.json(),async(req,res)=>{const {candidate_id,feedback_type,feedback_text}=req.body;const q=await db.query('insert into manager_feedback(candidate_id,feedback_type,feedback_text) values($1,$2,$3) returning *',[candidate_id,feedback_type,feedback_text]);res.json(q.rows[0])});

app.listen(Number(process.env.PORT||3000),()=>console.log('Resume Fit backend running'));
$resource$)
on conflict(resource_key) do update set body=excluded.body;
