require("dotenv").config();
const axios = require("axios");

const token = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const apiVersion = process.env.WHATSAPP_API_VERSION || "v19.0";

/**
 * Envia uma mensagem de texto pelo WhatsApp Cloud API.
 * numeroDestino: string no formato 55DDDNUMERO (sem +)
 * texto: corpo da mensagem
 */
async function enviarMensagemTexto(numeroDestino, texto) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const data = {
    messaging_product: "whatsapp",
    to: numeroDestino,
    type: "text",
    text: {
      body: texto
    }
  };

  try {
    const res = await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    console.log("Mensagem enviada:", res.data);
    return res.data;
  } catch (erro) {
    console.error(
      "Erro ao enviar mensagem WhatsApp:",
      erro.response?.data || erro.message
    );
    throw erro;
  }
}

module.exports = {
  enviarMensagemTexto
};