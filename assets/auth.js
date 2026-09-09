(function () {
  'use strict';

  const SUPABASE_URL = 'https://zqiqjzxcpznhzjengfff.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxaXFqenhjcHpuaHpqZW5nZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NjcwNDEsImV4cCI6MjEwMzM0MzA0MX0.Xbm_rHVt8Ku7GT7YY8PLUqbd8_6sXL4dZf0V6PGs7TA';

  const body = document.body;
  const gate = document.getElementById('authGate');
  const form = document.getElementById('authForm');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const confirmPasswordInput = document.getElementById('authConfirmPassword');
  const nameInput = document.getElementById('authName');
  const submitButton = document.getElementById('authSubmit');
  const message = document.getElementById('authMessage');
  const signOutButton = document.getElementById('authSignOut');
  const userEmail = document.getElementById('authUserEmail');
  const workspaceName = document.getElementById('authWorkspaceName');
  const welcomeModal = document.getElementById('welcomeModal');
  const welcomeMessage = document.getElementById('welcomeMessage');
  let appliedAccessToken = null;
  let authMode = 'signin';

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

  function showWelcome(text, buttonText) {
    welcomeMessage.textContent = text;
    document.getElementById('welcomeContinue').textContent = buttonText || 'Enter Ancalagon';
    welcomeModal.hidden = false;
  }

  document.getElementById('welcomeContinue').addEventListener('click', function () {
    welcomeModal.hidden = true;
  });

  function setAuthMode(mode) {
    authMode = mode;
    const creating = mode === 'create';
    document.getElementById('signInTab').classList.toggle('active', !creating);
    document.getElementById('createAccountTab').classList.toggle('active', creating);
    document.getElementById('signInTab').setAttribute('aria-selected', String(!creating));
    document.getElementById('createAccountTab').setAttribute('aria-selected', String(creating));
    document.getElementById('authNameField').hidden = !creating;
    document.getElementById('authConfirmField').hidden = !creating;
    nameInput.required = creating;
    confirmPasswordInput.required = creating;
    passwordInput.autocomplete = creating ? 'new-password' : 'current-password';
    submitButton.textContent = creating ? 'Create account' : 'Sign in';
    form.reset();
    showMessage(creating
      ? 'Create a private workspace with your name, work email, and password.'
      : 'Enter your existing account details.');
  }

  document.getElementById('signInTab').addEventListener('click', function () { setAuthMode('signin'); });
  document.getElementById('createAccountTab').addEventListener('click', function () { setAuthMode('create'); });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email || !password) return;

    if (authMode === 'create') {
      const displayName = nameInput.value.trim();
      if (!displayName) return;
      if (password !== confirmPasswordInput.value) {
        showMessage('The passwords do not match.', 'error');
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = 'Creating account…';
      showMessage('Creating your private workspace…');
      const redirectTo = window.location.origin + window.location.pathname;
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName }, emailRedirectTo: redirectTo }
      });
      submitButton.disabled = false;
      submitButton.textContent = 'Create account';

      if (error) {
        showMessage(error.message || 'Your account could not be created.', 'error');
        return;
      }

      form.reset();
      if (data.session) {
        showMessage('Account created. Opening your workspace…', 'success');
        showWelcome('Your account and private workspace have been created successfully.');
      } else {
        showMessage('Account created. Check your email once to confirm it, then sign in with your password.', 'success');
        showWelcome('Your account was created. Confirm the email from Ancalagon once, then return here and sign in with your password.', 'Return to sign in');
        setAuthMode('signin');
      }
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Signing in…';
    showMessage('Signing in securely…');

    const { error } = await client.auth.signInWithPassword({ email, password });

    submitButton.disabled = false;
    submitButton.textContent = 'Sign in';

    if (error) {
      showMessage('The email or password is incorrect.', 'error');
      return;
    }

    passwordInput.value = '';
    showMessage('Signed in successfully.', 'success');
  });

  document.getElementById('passwordForm')?.addEventListener('submit', async function (event) {
    event.preventDefault();
    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('confirmPassword').value;
    const button = document.getElementById('passwordSubmit');
    const status = document.getElementById('passwordMessage');

    if (password.length < 8) {
      status.textContent = 'Use at least 8 characters.';
      return;
    }
    if (password !== confirmation) {
      status.textContent = 'The passwords do not match.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Saving…';
    status.textContent = 'Updating your account…';
    const { error } = await client.auth.updateUser({ password });
    button.disabled = false;
    button.textContent = 'Set Password';

    if (error) {
      status.textContent = error.message || 'Your password could not be updated.';
      return;
    }

    event.currentTarget.reset();
    status.textContent = 'Password saved. Use it the next time you sign in.';
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
