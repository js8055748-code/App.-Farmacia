import os
import requests
from dotenv import load_dotenv

load_dotenv()

token = os.environ.get('WHATSAPP_TOKEN')
phone_number_id = os.environ.get('WHATSAPP_PHONE_NUMBER_ID')
api_version = os.environ.get('WHATSAPP_API_VERSION', 'v19.0')


def enviar_mensagem_texto(numero_destino, texto):
    url = f'https://graph.facebook.com/{api_version}/{phone_number_id}/messages'
    data = {
        'messaging_product': 'whatsapp',
        'to': numero_destino,
        'type': 'text',
        'text': {'body': texto},
    }
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    }
    resp = requests.post(url, json=data, headers=headers)
    resp.raise_for_status()
    print('Mensagem enviada:', resp.json())
    return resp.json()
