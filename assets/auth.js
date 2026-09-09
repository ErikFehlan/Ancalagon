(function () {
  'use strict';

  const SUPABASE_URL = 'https://zqiqjzxcpznhzjengfff.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxaXFqenhjcHpuaHpqZW5nZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NjcwNDEsImV4cCI6MjEwMzM0MzA0MX0.Xbm_rHVt8Ku7GT7YY8PLUqbd8_6sXL4dZf0V6PGs7TA';

  const body = document.body;
  const gate = document.getElementById('authGate');
  const form = document.getElementById('authForm');
  const emailInput = document.getElementById('authEmail');
  const submitButton = document.getElementById('authSubmit');
  const message = document.getElementById('authMessage');
  const signOutButton = document.getElementById('authSignOut');
  const userEmail = document.getElementById('authUserEmail');
  const workspaceName = document.getElementById('authWorkspaceName');
  let appliedAccessToken = null;

  function showMessage(text, type) {
    message.textContent = text;
    message.className = 'rf-auth-message' + (type ? ' ' + type : '');
  }

  function showGuest() {
    body.classList.remove('rf-auth-pending', 'rf-authenticated');
    body.classList.add('rf-auth-guest');
    gate.removeAttribute('aria-hidden');
    document.getElementById('rf-app').setAttribute('aria-hidden', 'true');
  }

  function showApplication(session, workspace) {
    body.classList.remove('rf-auth-pending', 'rf-auth-guest');
    body.classList.add('rf-authenticated');
    body.classList.add('rf-data-loading');
    gate.setAttribute('aria-hidden', 'true');
    document.getElementById('rf-app').removeAttribute('aria-hidden');
    userEmail.textContent = session.user.email || '';
    workspaceName.textContent = workspace?.name || 'Private workspace';
  }

  async function workspaceForUser(client) {
    const { data, error } = await client
      .from('workspace_members')
      .select('workspace_id, role, workspaces(name)')
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('No workspace is assigned to this account.');
    const relatedWorkspace = Array.isArray(data.workspaces)
      ? data.workspaces[0]
      : data.workspaces;

    return {
      id: data.workspace_id,
      role: data.role,
      name: relatedWorkspace?.name || 'Private workspace'
    };
  }

  async function applySession(client, session) {
    if (!session) {
      appliedAccessToken = null;
      window.ancalagonAuth = { client, session: null, workspace: null };
      showGuest();
      return;
    }

    if (session.access_token === appliedAccessToken && window.ancalagonAuth?.workspace) return;

    try {
      const workspace = await workspaceForUser(client);
      appliedAccessToken = session.access_token;
      window.ancalagonAuth = { client, session, workspace };
      showApplication(session, workspace);
      window.dispatchEvent(new CustomEvent('ancalagon:auth-ready', { detail: window.ancalagonAuth }));
    } catch (error) {
      showGuest();
      showMessage(error.message || 'Your workspace could not be loaded.', 'error');
    }
  }

  if (!window.supabase?.createClient) {
    showGuest();
    showMessage('The secure sign-in service could not load. Check your connection and refresh.', 'error');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  window.ancalagonSupabase = client;

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    if (!email) return;

    submitButton.disabled = true;
    submitButton.textContent = 'Sending secure link…';
    showMessage('Requesting access…');

    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo }
    });

    submitButton.disabled = false;
    submitButton.textContent = 'Email me a secure sign-in link';

    if (error) {
      showMessage(error.message || 'The sign-in link could not be sent.', 'error');
      return;
    }

    showMessage('Check your email for the secure Ancalagon sign-in link.', 'success');
  });

  signOutButton.addEventListener('click', async function () {
    signOutButton.disabled = true;
    try { await window.ancalagonFlush?.(); } catch (error) { console.warn('Final workspace sync failed', error); }
    await client.auth.signOut();
    signOutButton.disabled = false;
    showMessage('Signed out successfully.');
  });

  client.auth.onAuthStateChange(function (_event, session) {
    window.setTimeout(function () { applySession(client, session); }, 0);
  });

  client.auth.getSession().then(function ({ data, error }) {
    if (error) {
      showGuest();
      showMessage(error.message || 'Your session could not be restored.', 'error');
      return;
    }
    applySession(client, data.session);
  });
})();
