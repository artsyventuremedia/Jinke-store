(async function () {
  const { $, esc, api, toast, ready } = Store;
  await ready;
  const main = $('#main');
  const token = new URLSearchParams(location.search).get('token');

  if (!token) return askForEmail();
  const { valid } = await api('/auth/reset?token=' + encodeURIComponent(token));
  if (!valid) return askForEmail('This reset link has expired or was already used. Enter your email to get a new one.');

  main.innerHTML = `<div class="wrap auth-box"><form class="panel" id="rf">
    <h2>Choose a new password</h2>
    <div class="field"><label for="pw">New password</label><input class="input" id="pw" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
    <div class="field"><label for="pw2">Confirm new password</label><input class="input" id="pw2" name="confirm" type="password" minlength="8" required autocomplete="new-password"></div>
    <button class="btn btn-brand btn-block">Save password</button></form></div>`;
  $('#rf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { password, confirm } = Object.fromEntries(new FormData(e.target));
    if (password !== confirm) return toast('The two passwords do not match', true);
    try {
      const r = await api('/auth/reset', { body: { token, password } });
      toast('Password updated — you are now logged in');
      setTimeout(() => { location.href = r.role === 'admin' ? '/admin/' : '/account'; }, 900);
    } catch (err) { toast(err.message, true); }
  });

  function askForEmail(notice) {
    main.innerHTML = `<div class="wrap auth-box"><form class="panel" id="ff">
      <h2>Forgot your password?</h2>
      <p class="muted">${esc(notice || "Enter the email you use to log in and we'll send you a link to choose a new password.")}</p>
      <div class="field"><label for="fe">Email</label><input class="input" id="fe" name="email" type="email" required autocomplete="email"></div>
      <button class="btn btn-brand btn-block">Send reset link</button>
      <p style="text-align:center;font-size:14px;margin-bottom:0"><a href="/account" style="text-decoration:underline">Back to log in</a></p></form></div>`;
    $('#ff').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const email = e.target.email.value.trim();
        const r = await api('/auth/forgot', { body: { email } });
        e.target.innerHTML = `<h2>Check your inbox</h2><p>If an account exists for <b>${esc(email)}</b>, you'll get an email with a reset link in the next few minutes. The link expires in 1 hour.</p>
          ${r.email_enabled ? '' : `<p class="muted" style="font-size:13px">Not getting an email? Contact us at ${esc(Store.state.settings.email)} or ${esc(Store.state.settings.phone)}.</p>`}`;
      } catch (err) { toast(err.message, true); }
    });
  }
})();
