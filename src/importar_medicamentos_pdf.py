import sys
from pathlib import Path
import mysql.connector
from dotenv import load_dotenv
import pdfplumber

load_dotenv()

PDF_PATH = (
    Path(__file__).parent
    / '../pdf/Relaçao Municipal  de Medicamentos Essenciais- REMUME DIVINÓPOLIS- 2026.pdf'
)

db = mysql.connector.connect(
    host='localhost',
    user='root',
    password='',
    database='farmacia',
    port=3306,
)


def importar_do_pdf():
    if not PDF_PATH.exists():
        print(f'PDF não encontrado em: {PDF_PATH}')
        sys.exit(1)

    print(f'Lendo PDF em: {PDF_PATH}')

    with pdfplumber.open(str(PDF_PATH)) as pdf:
        text = '\n'.join(page.extract_text() or '' for page in pdf.pages)

    linhas_brutas = [l.strip() for l in text.split('\n') if l.strip()]
    print(f'Encontradas {len(linhas_brutas)} linhas no PDF.')

    sql_insert = 'INSERT INTO medicamentos (nome, apresentacao, ativo) VALUES (%s, %s, 1)'
    inseridos = 0
    cursor = db.cursor()

    for linha in linhas_brutas:
        partes = [p for p in linha.split() if p]
        idx_num = next(
            (i for i, p in enumerate(partes) if any(c.isdigit() for c in p)), -1
        )
        if idx_num == -1:
            nome = linha
            apresentacao = ''
        else:
            nome = ' '.join(partes[:idx_num])
            apresentacao = ' '.join(partes[idx_num:])
        try:
            cursor.execute(sql_insert, (nome, apresentacao))
            db.commit()
            inseridos += 1
        except mysql.connector.Error as e:
            print(f'Erro ao inserir medicamento: {nome} - {apresentacao}: {e}')

    print(f'Importação concluída. Medicamentos inseridos: {inseridos}')
    cursor.close()
    db.close()


if __name__ == '__main__':
    importar_do_pdf()
