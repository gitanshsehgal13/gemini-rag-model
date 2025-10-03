const express = require('express');
const router = express.Router();

// Import constants
const CONFIG = require('../../config/constants');

/**
 * Dialogflow Webhook Endpoint
 * Handles incoming requests from Dialogflow and integrates with existing RAG system
 * Always uses customer ID from constants
 */
router.post('/dialogflow', async (req, res) => {
  try {
    console.log('Received Dialogflow webhook request:', JSON.stringify(req.body, null, 2));

    const { queryResult, session } = req.body;
    
    if (!queryResult || !queryResult.queryText) {
      return res.status(400).json({
        fulfillmentText: "I didn't understand your request. Please try again.",
        fulfillmentMessages: [{
          text: {
            text: ["I didn't understand your request. Please try again."]
          }
        }]
      });
    }

    // Extract query text from Dialogflow request
    const queryText = queryResult.queryText;
    
    // Use customer ID from constants
    const customerId = CONFIG.DEFAULT_CUSTOMER_ID;

    console.log(`Processing Dialogflow query for customer ${customerId}: ${queryText}`);

    // Get customer service instance from app
    const customerService = req.app.get('customerService');
    
    if (!customerService) {
      console.error('Customer service not available');
      return res.status(500).json({
        fulfillmentText: "Sorry, the service is temporarily unavailable. Please try again later.",
        fulfillmentMessages: [{
          text: {
            text: ["Sorry, the service is temporarily unavailable. Please try again later."]
          }
        }]
      });
    }

    // Use existing queryDocuments functionality
    const result = await customerService.queryDocuments(customerId, queryText);

    console.log(`Dialogflow query result for ${customerId}:`, {
      confidence: result.confidence,
      queryType: result.queryType,
      sourceChunks: result.sourceChunks?.length || 0
    });

    // Format response for Dialogflow
    const answerText = result.answer || "I couldn't find specific information about your query. Please contact customer service for more detailed assistance.";
    
    const dialogflowResponse = {
      fulfillmentMessages: [{
        text: {
          text: [answerText]
        }
      }],
      // Optional: Add output contexts to maintain customer session
      outputContexts: [{
        name: `${session}/contexts/customer-session`,
        lifespanCount: 10,
        parameters: {
          customerId: customerId,
          lastQueryType: result.queryType,
          confidence: result.confidence
        }
      }]
    };

    console.log('Sending Dialogflow response:', JSON.stringify(dialogflowResponse, null, 2));
    
    res.json(dialogflowResponse);

  } catch (error) {
    console.error('Error processing Dialogflow webhook:', error);
    console.error('Error stack:', error.stack);
    
    const errorText = `Sorry, I encountered an error while processing your request: ${error.message}. Please try again.`;
    
    res.status(500).json({
      fulfillmentText: errorText,
      fulfillmentMessages: [{
        text: {
          text: [errorText]
        }
      }]
    });
  }
});

/**
 * Health check endpoint for webhook
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'dialogflow-webhook',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
