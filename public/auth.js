(function () {
  if (location.protocol === 'file:') {
    var page = location.pathname.split(/[\\/]/).pop() || 'index.html';
    location.replace('http://localhost:3000/' + page);
    return;
  }
  var token = localStorage.getItem('farmaToken');
  if (!token) {
    window.location.replace('login.html');
    return;
  }
  fetch('/api/verificar-token', { headers: { 'x-auth-token': token } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.autenticado) {
        localStorage.removeItem('farmaToken');
        localStorage.removeItem('farmaNome');
        window.location.replace('login.html');
      }
    })
    .catch(function () {});
})();
