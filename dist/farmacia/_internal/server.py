import sys
import os
import re
import hashlib
import secrets
import threading
from datetime import datetime, timedelta
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
import mysql.connector
from mysql.connector import pooling, Error as MySQLError
from apscheduler.schedulers.background import BackgroundScheduler
import pdfplumber
from whatsapp import enviar_mensagem_texto


def _get_resource(relpath):
    """Resolve path to bundled resources (public/, pdf/). Works in dev and PyInstaller."""
    bundle_dir = os.environ.get('FARMACIA_BUNDLE_DIR')
    if bundle_dir:
        return os.path.join(bundle_dir, relpath)
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, relpath)
    return os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', relpath))


load_dotenv()

sessoes = {}
sessoes_lock = threading.Lock()

remume_list = []


def carregar_remume_pdf():
    global remume_list
    pdf_path = _get_resource(
        'pdf/Relaçao Municipal  de Medicamentos Essenciais- REMUME DIVINÓPOLIS- 2026.pdf'
    )
    if not pdf_path.exists():
        print(f'⚠️ PDF REMUME não encontrado em: {pdf_path}')
        return
    try:
        print('📄 Carregando lista REMUME do PDF...')
        with pdfplumber.open(pdf_path) as pdf:
            text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        linhas = [l.strip() for l in text.split('\n') if len(l.strip()) > 3]
        temp = []
        for linha in linhas:
            partes = [p for p in linha.split() if p]
            idx_num = next(
                (i for i, p in enumerate(partes) if any(c.isdigit() for c in p)), -1
            )
            if idx_num == -1:
                temp.append({'nome': linha, 'apresentacao': ''})
            else:
                temp.append({
                    'nome': ' '.join(partes[:idx_num]),
                    'apresentacao': ' '.join(partes[idx_num:]),
                })
        remume_list = [
            m for m in temp
            if len(m['nome']) >= 3
            and len(m['nome'].split()) <= 5
            and not (
                not m['apresentacao']
                and m['nome'] == m['nome'].upper()
                and len(m['nome'].split()) > 2
            )
        ]
        print(f'✅ REMUME carregada: {len(remume_list)} medicamentos')
    except Exception as e:
        print(f'❌ Erro ao carregar REMUME: {e}')


carregar_remume_pdf()

app = Flask(__name__, static_folder=_get_resource('public'), static_url_path='')

db_pool = pooling.MySQLConnectionPool(
    pool_name='farmacia_pool',
    pool_size=10,
    host='localhost',
    user='root',
    password='',
    database='farmacia',
    port=3306,
)


def get_db():
    return db_pool.get_connection()


try:
    _conn = get_db()
    print('✅ Conectado ao MySQL com sucesso!')
    _conn.close()
except Exception as e:
    print(f'❌ Erro ao conectar no MySQL: {e}')

try:
    _conn = get_db()
    _cur = _conn.cursor()
    _cur.execute('''CREATE TABLE IF NOT EXISTS usuarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        cpf VARCHAR(14),
        data_nascimento DATE,
        email VARCHAR(255) UNIQUE NOT NULL,
        telefone VARCHAR(20),
        senha CHAR(64) NOT NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    _conn.commit()
    _cur.close()
    _conn.close()
    print('✅ Tabela usuarios verificada.')
except Exception as e:
    print(f'Erro ao criar tabela usuarios: {e}')


def limpar_sessoes_expiradas():
    with sessoes_lock:
        agora = datetime.now().timestamp() * 1000
        expirados = [t for t, s in sessoes.items() if agora > s['expira_em']]
        for t in expirados:
            del sessoes[t]


def verificar_lembretes():
    print('⏰ Agendador rodando — verificando lembretes...')
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        cursor.execute('''
            SELECT d.id, d.paciente_id, d.data_proxima_retirada, p.nome, p.telefone
            FROM dispensacoes d
            JOIN pacientes p ON p.id = d.paciente_id
            WHERE d.data_proxima_retirada = DATE_ADD(CURDATE(), INTERVAL 15 DAY)
              AND NOT EXISTS (
                SELECT 1 FROM mensagens_whatsapp m
                WHERE m.dispensacao_id = d.id
                  AND m.tipo = 'LEMBRETE_RETIRADA'
                  AND m.status_envio = 'ENVIADA'
              )
        ''')
        for row in cursor.fetchall():
            data_fmt = (
                row['data_proxima_retirada'].strftime('%d/%m/%Y')
                if hasattr(row['data_proxima_retirada'], 'strftime')
                else str(row['data_proxima_retirada'])
            )
            texto = (
                f"Olá, {row['nome']}! 👋\n\n"
                f"Lembramos que sua próxima retirada de medicamentos está marcada "
                f"para o dia {data_fmt}.\n\n"
                f"Compareça à farmácia na data indicada.\n\n"
                f"Esta mensagem não precisa ser respondida."
            )
            _registrar_mensagem(conn, cursor, row, texto, 'LEMBRETE_RETIRADA')

        cursor.execute('''
            SELECT d.id, d.paciente_id, d.data_para_renovacao, p.nome, p.telefone
            FROM dispensacoes d
            JOIN pacientes p ON p.id = d.paciente_id
            WHERE d.data_para_renovacao = DATE_ADD(CURDATE(), INTERVAL 10 DAY)
              AND NOT EXISTS (
                SELECT 1 FROM mensagens_whatsapp m
                WHERE m.dispensacao_id = d.id
                  AND m.tipo = 'LEMBRETE_RENOVACAO'
                  AND m.status_envio = 'ENVIADA'
              )
        ''')
        for row in cursor.fetchall():
            data_fmt = (
                row['data_para_renovacao'].strftime('%d/%m/%Y')
                if hasattr(row['data_para_renovacao'], 'strftime')
                else str(row['data_para_renovacao'])
            )
            texto = (
                f"Olá, {row['nome']}! 👋\n\n"
                f"Sua receita médica vence em {data_fmt}.\n\n"
                f"Providencie a renovação com seu médico antes dessa data para não "
                f"interromper o tratamento.\n\n"
                f"Esta mensagem não precisa ser respondida."
            )
            _registrar_mensagem(conn, cursor, row, texto, 'LEMBRETE_RENOVACAO')

        cursor.close()
        conn.close()
    except Exception as e:
        print(f'Erro no agendador: {e}')


def _registrar_mensagem(conn, cursor, row, texto, tipo):
    sql_msg = (
        'INSERT INTO mensagens_whatsapp '
        '(paciente_id, dispensacao_id, telefone_destino, mensagem, tipo, status_envio, erro_detalhe) '
        'VALUES (%s, %s, %s, %s, %s, %s, %s)'
    )
    try:
        enviar_mensagem_texto(row['telefone'], texto)
        cursor.execute(sql_msg, (row['paciente_id'], row['id'], row['telefone'], texto, tipo, 'ENVIADA', None))
        conn.commit()
        print(f"✅ Lembrete {tipo} enviado para {row['nome']}")
    except Exception as e:
        cursor.execute(sql_msg, (row['paciente_id'], row['id'], row['telefone'], texto, tipo, 'ERRO', str(e)))
        conn.commit()
        print(f"❌ Erro ao enviar lembrete para {row['nome']}: {e}")


scheduler = BackgroundScheduler()
scheduler.add_job(verificar_lembretes, 'cron', hour=8, minute=0)
scheduler.add_job(limpar_sessoes_expiradas, 'interval', hours=1)
scheduler.start()


# === Rotas ===

@app.route('/api/pacientes', methods=['POST'])
def cadastrar_paciente():
    data = request.get_json() or {}
    print('REQ BODY /api/pacientes:', data)
    nome = (data.get('nome') or '').strip()
    cpf = (data.get('cpf') or '').strip()
    data_nascimento = data.get('data_nascimento') or None
    telefone = (data.get('telefone') or '').strip() or None
    endereco = data.get('endereco') or None
    if not nome or not cpf:
        return jsonify({'erro': 'Nome e CPF são obrigatórios.'}), 400
    sql = (
        'INSERT INTO pacientes (nome, cpf, telefone, data_nascimento, endereco) '
        'VALUES (%s, %s, %s, %s, %s)'
    )
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(sql, (nome, cpf, telefone, data_nascimento, endereco))
        conn.commit()
        insert_id = cursor.lastrowid
        cursor.close()
        conn.close()
        return jsonify({'ok': True, 'id': insert_id}), 201
    except MySQLError as e:
        if e.errno == 1062:
            return jsonify({'erro': 'CPF já cadastrado.'}), 409
        print(f'Erro ao salvar paciente: {e}')
        return jsonify({'erro': 'Erro ao salvar paciente.'}), 500


@app.route('/api/pacientes/cpf/<cpf>', methods=['GET'])
def buscar_paciente_por_cpf(cpf):
    if not cpf:
        return jsonify({'erro': 'CPF é obrigatório.'}), 400
    cpf_limpo = re.sub(r'\D', '', cpf)
    sql = (
        "SELECT id, nome, cpf, telefone FROM pacientes "
        "WHERE REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = %s LIMIT 1"
    )
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql, (cpf_limpo,))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if not result:
            return jsonify({'paciente': None})
        return jsonify({
            'paciente': {
                'id': result['id'],
                'nome': result['nome'],
                'cpf': result['cpf'],
                'telefone': result['telefone'],
            }
        })
    except Exception as e:
        print(f'Erro ao buscar paciente: {e}')
        return jsonify({'erro': 'Erro ao buscar paciente.'}), 500


@app.route('/api/medicamentos', methods=['GET'])
def listar_medicamentos():
    term = (request.args.get('term') or '').strip()
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        if not term:
            cursor.execute(
                'SELECT id, nome, principio_ativo, apresentacao, controlado, estoque_atual AS estoque '
                'FROM medicamentos WHERE ativo = 1 ORDER BY nome'
            )
            results = cursor.fetchall()
            cursor.close()
            conn.close()
            return jsonify({'medicamentos': results})
        cursor.execute(
            'SELECT id, nome, principio_ativo, apresentacao, controlado, estoque_atual AS estoque '
            'FROM medicamentos WHERE ativo = 1 AND nome LIKE %s ORDER BY nome LIMIT 20',
            (f'%{term}%',),
        )
        results = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(results)
    except Exception as e:
        print(f'Erro ao listar medicamentos: {e}')
        return jsonify({'erro': 'Erro ao listar medicamentos.'}), 500


@app.route('/api/medicamentos', methods=['POST'])
def cadastrar_medicamento():
    data = request.get_json() or {}
    nome = (data.get('nome') or '').strip()
    if not nome:
        return jsonify({'erro': 'Nome é obrigatório.'}), 400
    principio_ativo = data.get('principio_ativo') or None
    apresentacao = data.get('apresentacao') or None
    estoque = data.get('estoque') or 0
    controlado = 1 if data.get('controlado') else 0
    sql = (
        'INSERT INTO medicamentos (nome, principio_ativo, apresentacao, estoque_atual, controlado) '
        'VALUES (%s, %s, %s, %s, %s)'
    )
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(sql, (nome, principio_ativo, apresentacao, estoque, controlado))
        conn.commit()
        insert_id = cursor.lastrowid
        cursor.close()
        conn.close()
        return jsonify({'ok': True, 'id': insert_id}), 201
    except Exception as e:
        print(f'Erro ao cadastrar medicamento: {e}')
        return jsonify({'erro': 'Erro ao cadastrar medicamento.'}), 500


@app.route('/api/medicamentos/<int:med_id>', methods=['PUT'])
def atualizar_medicamento(med_id):
    data = request.get_json() or {}
    nome = (data.get('nome') or '').strip()
    if not nome:
        return jsonify({'erro': 'Nome é obrigatório.'}), 400
    principio_ativo = data.get('principio_ativo') or None
    apresentacao = data.get('apresentacao') or None
    estoque = data.get('estoque') or 0
    controlado = 1 if data.get('controlado') else 0
    sql = (
        'UPDATE medicamentos SET nome=%s, principio_ativo=%s, apresentacao=%s, '
        'estoque_atual=%s, controlado=%s WHERE id=%s'
    )
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(sql, (nome, principio_ativo, apresentacao, estoque, controlado, med_id))
        conn.commit()
        affected = cursor.rowcount
        cursor.close()
        conn.close()
        if affected == 0:
            return jsonify({'erro': 'Medicamento não encontrado.'}), 404
        return jsonify({'ok': True})
    except Exception as e:
        print(f'Erro ao atualizar medicamento: {e}')
        return jsonify({'erro': 'Erro ao atualizar medicamento.'}), 500


@app.route('/api/remume', methods=['GET'])
def buscar_remume():
    term = (request.args.get('term') or '').lower().strip()
    if not term or len(term) < 2:
        return jsonify([])
    resultados = [m for m in remume_list if term in m['nome'].lower()][:20]
    return jsonify(resultados)


@app.route('/api/medicamentos/<int:med_id>/adicionar-estoque', methods=['POST'])
def adicionar_estoque(med_id):
    data = request.get_json() or {}
    try:
        qtd = int(data.get('quantidade', 0))
    except (ValueError, TypeError):
        return jsonify({'erro': 'Quantidade inválida.'}), 400
    if qtd <= 0:
        return jsonify({'erro': 'Quantidade inválida.'}), 400
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE medicamentos SET estoque_atual = estoque_atual + %s WHERE id = %s',
            (qtd, med_id),
        )
        conn.commit()
        affected = cursor.rowcount
        cursor.close()
        conn.close()
        if affected == 0:
            return jsonify({'erro': 'Medicamento não encontrado.'}), 404
        return jsonify({'ok': True})
    except Exception as e:
        print(f'Erro ao adicionar estoque: {e}')
        return jsonify({'erro': 'Erro ao atualizar estoque.'}), 500


@app.route('/api/dispensar', methods=['POST'])
def dispensar():
    data = request.get_json() or {}
    print('REQ BODY /api/dispensar:', data)
    paciente_id = data.get('paciente_id')
    nome_paciente = data.get('nome_paciente')
    telefone = data.get('telefone')
    medicamentos = data.get('medicamentos', [])
    data_proxima_retirada = data.get('data_proxima_retirada')
    data_para_renovacao = data.get('data_para_renovacao')
    observacoes = data.get('observacoes')

    if (
        not paciente_id
        or not data_proxima_retirada
        or not data_para_renovacao
        or not isinstance(medicamentos, list)
        or len(medicamentos) == 0
    ):
        return jsonify({'erro': 'Dados obrigatórios da dispensação ausentes.'}), 400

    def converter_data(d):
        parts = d.split('-')  # DD-MM-YYYY
        return f'{parts[2]}-{parts[1]}-{parts[0]}'  # YYYY-MM-DD

    data_retirada_sql = converter_data(data_proxima_retirada)
    data_renovacao_sql = converter_data(data_para_renovacao)

    conn = get_db()
    try:
        conn.start_transaction()
        cursor = conn.cursor()

        cursor.execute(
            'INSERT INTO dispensacoes (paciente_id, data_proxima_retirada, data_para_renovacao, observacoes) '
            'VALUES (%s, %s, %s, %s)',
            (paciente_id, data_retirada_sql, data_renovacao_sql, observacoes or None),
        )
        dispensacao_id = cursor.lastrowid

        for med in medicamentos:
            med_id = med.get('medicamento_id')
            if med_id is not None:
                try:
                    med_id = int(med_id)
                except (ValueError, TypeError):
                    med_id = None
            cursor.execute(
                'INSERT INTO dispensacao_itens '
                '(dispensacao_id, medicamento_id, nome_medicamento, quantidade, unidade) '
                'VALUES (%s, %s, %s, %s, %s)',
                (dispensacao_id, med_id, med.get('nome') or None, med.get('quantidade'), med.get('unidade') or None),
            )

        for med in medicamentos:
            try:
                med_id = int(med['medicamento_id'])
                cursor.execute(
                    'UPDATE medicamentos SET estoque_atual = GREATEST(0, estoque_atual - %s) WHERE id = %s',
                    (med['quantidade'], med_id),
                )
            except (ValueError, TypeError, KeyError):
                pass

        conn.commit()
        cursor.close()

        lista_meds = '\n'.join(
            f"- {m.get('nome')} ({m.get('quantidade')}"
            f"{' ' + m.get('unidade') if m.get('unidade') else ''})"
            for m in medicamentos
        )
        saudacao = f'Olá, {nome_paciente}! 👋' if nome_paciente else 'Olá! 👋'
        texto = (
            f'{saudacao}\n\n'
            f'Sua retirada de medicamentos foi registrada com sucesso.\n\n'
            f'📋 Medicamentos dispensados:\n{lista_meds}\n\n'
            f'📅 Próxima retirada: {data_proxima_retirada}.\n'
            f'🔄 Renovação da receita: {data_para_renovacao}.\n\n'
            f'Esta mensagem não precisa ser respondida.'
        )
        sql_msg = (
            'INSERT INTO mensagens_whatsapp '
            '(paciente_id, dispensacao_id, telefone_destino, mensagem, tipo, status_envio, erro_detalhe) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s)'
        )
        if telefone:
            cursor2 = conn.cursor()
            try:
                enviar_mensagem_texto(telefone, texto)
                cursor2.execute(sql_msg, (paciente_id, dispensacao_id, telefone, texto, 'CONFIRMACAO', 'ENVIADA', None))
            except Exception as e_wpp:
                cursor2.execute(sql_msg, (paciente_id, dispensacao_id, telefone, texto, 'CONFIRMACAO', 'ERRO', str(e_wpp)))
            conn.commit()
            cursor2.close()

        conn.close()
        return jsonify({
            'ok': True,
            'dispensacao_id': dispensacao_id,
            'mensagem': 'Dispensação registrada com sucesso.',
        })
    except Exception as e:
        conn.rollback()
        conn.close()
        print(f'Erro na dispensação: {e}')
        return jsonify({'erro': 'Erro ao salvar dispensação no banco.'}), 500


@app.route('/api/usuarios', methods=['POST'])
def cadastrar_usuario():
    data = request.get_json() or {}
    nome = (data.get('nome') or '').strip()
    cpf = (data.get('cpf') or '').strip()
    data_nascimento = data.get('data_nascimento') or None
    email = (data.get('email') or '').strip().lower()
    telefone = data.get('telefone') or None
    if not nome or not email or not cpf:
        return jsonify({'erro': 'Nome, e-mail e CPF são obrigatórios.'}), 400
    cpf_limpo = re.sub(r'\D', '', cpf)
    if len(cpf_limpo) != 11:
        return jsonify({'erro': 'CPF inválido.'}), 400
    senha_hash = hashlib.sha256(cpf_limpo.encode()).hexdigest()
    sql = (
        'INSERT INTO usuarios (nome, cpf, data_nascimento, email, telefone, senha) '
        'VALUES (%s, %s, %s, %s, %s, %s)'
    )
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(sql, (nome, cpf, data_nascimento, email, telefone, senha_hash))
        conn.commit()
        insert_id = cursor.lastrowid
        cursor.close()
        conn.close()
        return jsonify({'ok': True, 'id': insert_id}), 201
    except MySQLError as e:
        if e.errno == 1062:
            return jsonify({'erro': 'E-mail já cadastrado.'}), 409
        print(f'Erro ao salvar usuário: {e}')
        return jsonify({'erro': 'Erro ao salvar usuário.'}), 500


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    senha = data.get('senha') or ''
    if not email or not senha:
        return jsonify({'erro': 'E-mail e senha são obrigatórios.'}), 400
    senha_hash = hashlib.sha256(senha.encode()).hexdigest()
    senha_digitos_hash = hashlib.sha256(re.sub(r'\D', '', senha).encode()).hexdigest()
    sql = 'SELECT id, nome FROM usuarios WHERE email = %s AND (senha = %s OR senha = %s) LIMIT 1'
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql, (email, senha_hash, senha_digitos_hash))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if not result:
            return jsonify({'erro': 'E-mail ou senha incorretos.'}), 401
        token = secrets.token_hex(32)
        with sessoes_lock:
            sessoes[token] = {
                'userId': result['id'],
                'nome': result['nome'],
                'expira_em': (datetime.now() + timedelta(hours=8)).timestamp() * 1000,
            }
        return jsonify({'ok': True, 'token': token, 'nome': result['nome']})
    except Exception as e:
        print(f'Erro ao verificar login: {e}')
        return jsonify({'erro': 'Erro ao verificar credenciais.'}), 500


@app.route('/api/verificar-token', methods=['GET'])
def verificar_token():
    token = request.headers.get('x-auth-token')
    if not token:
        return jsonify({'autenticado': False}), 401
    with sessoes_lock:
        sessao = sessoes.get(token)
        if not sessao or datetime.now().timestamp() * 1000 > sessao['expira_em']:
            if sessao:
                del sessoes[token]
            return jsonify({'autenticado': False}), 401
    return jsonify({'autenticado': True, 'nome': sessao['nome']})


@app.route('/api/logout', methods=['DELETE'])
def logout():
    token = request.headers.get('x-auth-token')
    if token:
        with sessoes_lock:
            sessoes.pop(token, None)
    return jsonify({'ok': True})


@app.route('/api/dispensacoes/paciente/<int:paciente_id>', methods=['GET'])
def historico_dispensacoes(paciente_id):
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            'SELECT id, data_proxima_retirada, data_para_renovacao, observacoes '
            'FROM dispensacoes WHERE paciente_id = %s ORDER BY data_proxima_retirada DESC LIMIT 20',
            (paciente_id,),
        )
        disp_rows = cursor.fetchall()
        if not disp_rows:
            cursor.close()
            conn.close()
            return jsonify({'dispensacoes': []})

        ids_disp = [d['id'] for d in disp_rows]
        placeholders = ','.join(['%s'] * len(ids_disp))
        cursor.execute(
            f"SELECT di.dispensacao_id, di.quantidade, di.unidade, "
            f"COALESCE(m.nome, di.nome_medicamento, '') AS nome "
            f"FROM dispensacao_itens di "
            f"LEFT JOIN medicamentos m ON m.id = di.medicamento_id "
            f"WHERE di.dispensacao_id IN ({placeholders})",
            ids_disp,
        )
        itens_rows = cursor.fetchall()
        cursor.close()
        conn.close()

        itens_por_disp = {}
        for row in itens_rows:
            disp_id = row['dispensacao_id']
            itens_por_disp.setdefault(disp_id, []).append({
                'nome': row['nome'] or '',
                'quantidade': row['quantidade'],
                'unidade': row['unidade'] or None,
            })

        def formatar_data_br(d):
            if hasattr(d, 'strftime'):
                return d.strftime('%d/%m/%Y')
            return str(d)

        resposta = [
            {
                'id': d['id'],
                'data_proxima_retirada': formatar_data_br(d['data_proxima_retirada']),
                'data_para_renovacao': formatar_data_br(d['data_para_renovacao']),
                'observacoes': d['observacoes'],
                'medicamentos': itens_por_disp.get(d['id'], []),
            }
            for d in disp_rows
        ]
        return jsonify({'dispensacoes': resposta})
    except Exception as e:
        print(f'Erro ao buscar dispensações: {e}')
        return jsonify({'erro': 'Erro ao buscar dispensações.'}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print(f'🚀 Servidor rodando na porta {port}')
    app.run(host='0.0.0.0', port=port, debug=False)
