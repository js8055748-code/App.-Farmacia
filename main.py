import sys
import os
import threading
import webbrowser
import time

# Resolve diretórios antes de qualquer importação
if getattr(sys, 'frozen', False):
    _EXE_DIR = os.path.dirname(sys.executable)
    _BUNDLE_DIR = sys._MEIPASS
else:
    _EXE_DIR = os.path.dirname(os.path.abspath(__file__))
    _BUNDLE_DIR = _EXE_DIR
    sys.path.insert(0, os.path.join(_EXE_DIR, 'src'))

# Muda para o diretório do exe para que o .env seja encontrado
os.chdir(_EXE_DIR)

# Passa os caminhos para server.py via variável de ambiente
os.environ['FARMACIA_BUNDLE_DIR'] = _BUNDLE_DIR

# Importa e inicializa o servidor (roda código de nível de módulo: DB, REMUME, scheduler)
import server

PORT = int(os.environ.get('PORT', 3000))


def _abrir_navegador():
    time.sleep(2)
    webbrowser.open(f'http://localhost:{PORT}')


threading.Thread(target=_abrir_navegador, daemon=True).start()

print(f'🚀 Servidor iniciado! Acesse: http://localhost:{PORT}')
server.app.run(host='0.0.0.0', port=PORT, debug=False, use_reloader=False)
