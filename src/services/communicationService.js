const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

/**
 * Communication Service
 * Handles WhatsApp communication through Infobip API
 */
class CommunicationService {
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || 'http://localhost:9000/api/bot/whatsapp/incoming-messages';
  }

  /**
   * Send a WhatsApp message with static data
   * @param {string} text - Message text to send
   * @returns {Promise<Object>} - API response
   */
  async sendMessage(text) {
    const payload = {
      id: `${uuidv4()}`,
      channel: "WHATSAPP",
      from: "9984477271",
      to: "919136160375",
      direction: "INBOUND",
      conversationId: "0bdff7f0-58e3-416b-bdea-a78d0743dfe7",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: {
        text: text
      },
      singleSendMessage: {
        from: {
          phoneNumber: "919984477271",
          type: "PHONE_NUMBER"
        },
        to: {
          phoneNumber: "919136160375",
          type: "PHONE_NUMBER"
        },
        content: {
          url: "https://api.infobip.com/whatsapp/1/senders/919136160375/media/948397609810633",
          caption: "TEST0010_3f714ac9-d876-42ff-bdde-3481f43cb9de.pdf",
          context: null,
          referral: null,
          type: "TEXT"
        },
        contact: {
          name: "Gitansh Sehgal"
        },
        identity: null,
        channel: "WHATSAPP",
        direction: "INBOUND"
      },
      contentType: "TEXT",
      disableAIAgentCall:true
    };

    console.log('Sending message to:', this.apiEndpoint);
    console.log('Message payload:', JSON.stringify(payload, null, 2));

    try {
      const response = await axios.post(this.apiEndpoint, payload, {
        headers: {
          'apikey': 'ABSFiHBIgxSeREDuBb8soBi5EAWKim6k7LlsGwBEd456BHR0lKYUCd4mfoSK',
          'Content-Type': 'application/json'
        }
      });

      console.log('Message sent successfully:', response.data);
      return {
        success: true,
        data: response.data,
        payload: payload
      };
    } catch (error) {
      console.error('Error sending message:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message,
        payload: payload
      };
    }
  }
}

module.exports = CommunicationService;

