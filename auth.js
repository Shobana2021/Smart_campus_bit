
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Smart Campus | Student Login</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="login">
  <div class="lbox">
    <div class="logo">🎓</div>
    <h1>Smart Campus</h1>
    <p>Bannari Amman Institute of Technology (BIT)</p>

    <label for="em">College email</label>
    <input id="em" type="email"
      placeholder="studentname@bitsathy.ac.in"
      autocomplete="username">

    <label for="pw">Password</label>
    <div class="pw">
      <input id="pw" type="password"
        placeholder="Create password or enter password"
        autocomplete="current-password">
      <button type="button" id="eye">Show</button>
    </div>

    <div class="err" id="err" role="alert"></div>

    <button class="btn" id="go" type="button">Sign in</button>

    <div class="or">New student?</div>

    <button class="btn" id="signup" type="button">
      Create Student Account
    </button>

    <div class="or">or</div>

    <button class="btn ghost" id="gg" type="button">
      Continue with Google
    </button>

    <p style="margin:18px 0 0">
      <a href="#" id="fp">Forgot password?</a>
    </p>
  </div>

  <script type="module">
    import {
      signIn,
      signUp,
      google,
      reset,
      getToken
    } from './js/auth.js';

    const $ = id => document.getElementById(id);
    const fail = message => $('err').textContent = message;

    const base = location.pathname.includes('/Smart_campus_bit/')
      ? '/Smart_campus_bit/'
      : '/';

    const nextParam =
      new URLSearchParams(location.search).get('next');

    const next = nextParam &&
      nextParam.startsWith(base) &&
      !nextParam.includes('login.html')
        ? nextParam
        : base + 'index.html';

    const validEmail = email =>
      /^[^\s@]+@bitsathy\.ac\.in$/i.test(email.trim());

    if (await getToken()) {
      location.replace(next);
    }

    $('eye').onclick = () => {
      const password = $('pw');
      password.type =
        password.type === 'password' ? 'text' : 'password';
      $('eye').textContent =
        password.type === 'password' ? 'Show' : 'Hide';
    };

    $('go').onclick = async () => {
      fail('');

      const email = $('em').value.trim().toLowerCase();
      const password = $('pw').value;

      if (!validEmail(email)) {
        return fail('Use your @bitsathy.ac.in college email.');
      }

      if (!password) {
        return fail('Enter your password.');
      }

      try {
        await signIn(email, password);
        location.replace(next);
      } catch (error) {
        fail(error.message || 'Login failed. Please try again.');
      }
    };

    $('signup').onclick = async () => {
      fail('');

      const email = $('em').value.trim().toLowerCase();
      const password = $('pw').value;

      if (!validEmail(email)) {
        return fail('Use your @bitsathy.ac.in college email.');
      }

      if (password.length < 6) {
        return fail('Password must be at least 6 characters.');
      }

      $('signup').disabled = true;

      try {
        await signUp(email, password);
        fail('Verification email sent! Check your college inbox.');
      } catch (error) {
        fail(error.message || 'Registration failed.');
      } finally {
        $('signup').disabled = false;
      }
    };

    $('gg').onclick = async () => {
      fail('');

      try {
        await google();
        location.replace(next);
      } catch (error) {
        fail(error.message || 'Google login failed.');
      }
    };

    $('fp').onclick = async event => {
      event.preventDefault();
      fail('');

      const email = $('em').value.trim().toLowerCase();

      if (!validEmail(email)) {
        return fail('Enter your college email first.');
      }

      try {
        await reset(email);
        fail('If the account exists, a password reset email will be sent.');
      } catch (error) {
        fail(error.message || 'Could not send reset email.');
      }
    };
  </script>
</body>
</html>
