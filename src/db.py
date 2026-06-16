import os
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()

connection_pool = psycopg2.pool.SimpleConnectionPool(
    1,
    10,
    dsn=os.environ.get('DATABASE_URL'),
    sslmode='require',
)


def get_connection():
    return connection_pool.getconn()


def release_connection(conn):
    connection_pool.putconn(conn)


try:
    conn = get_connection()
    print('✅ Conectado ao banco de dados Neon com sucesso!')
    release_connection(conn)
except Exception as e:
    print(f'❌ Erro ao conectar ao banco de dados: {e}')
