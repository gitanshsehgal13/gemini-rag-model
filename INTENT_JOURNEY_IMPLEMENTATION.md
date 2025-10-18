# Intent-Based Journey Implementation

## Overview

This document describes the complete implementation of the intent-based conversational journey system for the Gemini RAG System. The system enables context-aware, guided conversations with customers based on predefined business intents.

## Architecture

### Components Created/Modified

1. **IntentJourneyService** (`src/services/intentJourneyService.js`)
   - Manages intent-based conversations
   - Maintains conversation history per customer
   - Integrates with Gemini AI for response generation

2. **GeminiService** (`src/services/geminiService.js`)
   - Added `generateIntentBasedResponse()` method
   - Handles intent-based prompt generation

3. **CustomerService** (`src/services/customerService.js`)
   - Integrated IntentJourneyService
   - Routes queries with `intent` field to journey handler

4. **Query API Route** (`src/routes/customers.js`)
   - Updated to accept optional `intent` field
   - Passes intent through to CustomerService

5. **Communication Service** (`src/services/communicationService.js`)
   - Simple WhatsApp message payload generation
   - Uses UUID for unique message IDs

## Data Structure

### Intent Configuration (`data/intentBasedJouneys.json`)

```json
[{
  "intent": "EVENT_DRIVEN_CLAIM_EPISODE",
  "status": "active",
  "brand_voice": {
    "tone": "empathetic, supportive, professional",
    "style": "conversational but concise",
    "persona": "Claim Concierge"
  },
  "business_goals": [
    "Provide real-time claim tracking and updates",
    "Offer post-recovery engagement and medical follow-up",
    "Increase app usage and customer satisfaction"
  ],
  "recomendedAction": [
    "Hey {{customerName}} it seems like...",
    "..."
  ]
}]
```

### Conversation History Format

```json
{
  "intent": "EVENT_DRIVEN_CLAIM_EPISODE",
  "customerId": "9988676666",
  "status": "active",
  "customerContextHistory": [
    {
      "communicationMode": "WHATSAPP",
      "sentMessage": "Hey there! It seems like...",
      "timestamp": "2025-10-12T..."
    },
    {
      "communicationMode": "WHATSAPP",
      "incommingMessage": "Yes I need help",
      "timestamp": "2025-10-12T..."
    }
  ]
}
```

### Request to Gemini LLM

```json
{
  "intent": "EVENT_DRIVEN_CLAIM_EPISODE",
  "customerId": "9988676666",
  "status": "active",
  "customerContextHistory": [...],
  "newIncommingMessage": {
    "communicationMode": "WHATSAPP",
    "incommingMessage": "Can you find me the nearest hospitals?"
  },
  "brand_voice": { ... },
  "business_goals": [ ... ],
  "recomendedAction": [ ... ]
}
```

## API Usage

### Query Endpoint with Intent

**Endpoint**: `POST /api/customers/:customerId/query`

**Request Body**:
```json
{
  "query": "I need to find a hospital near me",
  "intent": "EVENT_DRIVEN_CLAIM_EPISODE",
  "options": {
    "communicationMode": "WHATSAPP"
  }
}
```

**Response**:
```json
{
  "customerId": "9988676666",
  "query": "I need to find a hospital near me",
  "intent": "EVENT_DRIVEN_CLAIM_EPISODE",
  "answer": "Hey there! It seems like you're trying to find hospitals near you...",
  "conversationId": "uuid-conversation-id",
  "conversationHistory": [
    {
      "communicationMode": "WHATSAPP",
      "incommingMessage": "I need to find a hospital near me",
      "timestamp": "2025-10-12T..."
    },
    {
      "communicationMode": "WHATSAPP",
      "sentMessage": "Hey there! It seems like...",
      "timestamp": "2025-10-12T..."
    }
  ],
  "confidence": 1.0,
  "queryType": "intent_journey"
}
```

### Regular Query (without intent)

Works exactly as before - the `intent` field is optional:

```json
{
  "query": "What is my premium amount?",
  "options": {
    "topK": 5
  }
}
```

## Features Implemented

### ✅ Intent-Based Journey Management
- Load intent configurations from JSON
- Route queries based on intent field
- Maintain separate journeys per customer

### ✅ Conversation History
- Store complete conversation history per journey
- Include both incoming and sent messages
- Track timestamps and communication modes
- Link history to unique conversation IDs

### ✅ Context-Aware Responses
- Feed Gemini with brand voice, business goals, and recommended actions
- Include previous conversation context
- Generate responses that follow action flow

### ✅ Conversation ID Management
- Generate unique conversation ID per journey
- Track active journeys per customer
- Support for journey status (active/closed)

### ✅ Communication Mode Support
- Support for multiple channels (WHATSAPP, etc.)
- Track communication mode in history
- Configurable per request

## Testing

### Test Scripts

1. **Test Communication Service**:
   ```bash
   npm run test:communication
   ```

2. **Test Intent Journey (Full Flow)**:
   ```bash
   npm run test:intent-journey
   ```

3. **Test Single Query**:
   ```bash
   node test-intent-journey.js single "I need a hospital"
   ```

### Manual Testing with cURL

```bash
# Start the server
npm run dev

# Send intent-based query
curl -X POST http://localhost:3000/api/customers/9988676666/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "I need to find a hospital near me",
    "intent": "EVENT_DRIVEN_CLAIM_EPISODE",
    "options": {
      "communicationMode": "WHATSAPP"
    }
  }'

# Continue conversation (same customer ID)
curl -X POST http://localhost:3000/api/customers/9988676666/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Yes, I need admission",
    "intent": "EVENT_DRIVEN_CLAIM_EPISODE"
  }'
```

## Key Classes and Methods

### IntentJourneyService

| Method | Description |
|--------|-------------|
| `processIntentJourney()` | Main method to process intent-based queries |
| `generateIntentResponse()` | Generate response from Gemini with context |
| `buildSystemPrompt()` | Build comprehensive prompt for Gemini |
| `getConversationHistory()` | Retrieve conversation history for customer |
| `getActiveJourney()` | Get active journey data for customer |
| `closeJourney()` | Close/end a customer journey |

### GeminiService

| Method | Description |
|--------|-------------|
| `generateIntentBasedResponse()` | Generate intent-based conversational responses |

### CommunicationService

| Method | Description |
|--------|-------------|
| `sendMessage(text)` | Generate WhatsApp message payload with static data |

## Storage

### In-Memory Storage (Current Implementation)

- **conversationHistories**: Map of conversationId → conversation array
- **customerJourneys**: Map of customerId → journey data

### Future Enhancements (Recommended)

- Persist conversation history to database
- Implement conversation archival
- Add conversation analytics
- Support for multiple concurrent journeys per customer

## Configuration

### Intent Configuration File

Location: `data/intentBasedJouneys.json`

Structure:
- `intent`: Unique intent identifier
- `status`: active/inactive
- `brand_voice`: Tone, style, persona
- `business_goals`: Array of business objectives
- `recomendedAction`: Array of action flow steps

## Error Handling

- Invalid intent name → Error message
- Missing customer → 404 error
- Gemini API failure → Error with fallback
- Conversation not found → Create new journey

## Backward Compatibility

✅ Fully backward compatible:
- Queries without `intent` field work as before
- Existing API endpoints unchanged
- No breaking changes to existing functionality

## Performance Considerations

- Conversation histories stored in memory
- No caching for intent-based responses (each unique)
- Gemini API calls per message (not cached)
- Suitable for moderate concurrent users

## Security

- Customer ID validation required
- No sensitive data in conversation history
- Intent configurations server-side only
- API key secured in config

## Next Steps (Future Enhancements)

1. **Database Integration**
   - Persist conversation histories
   - Store journey states
   - Enable conversation retrieval

2. **Advanced Features**
   - Multi-turn conversation tracking
   - Intent switching mid-conversation
   - Conversation summarization
   - Analytics and insights

3. **Integration**
   - Actual WhatsApp API integration
   - Multi-channel support
   - Webhook handlers for incoming messages

4. **Monitoring**
   - Journey completion rates
   - Customer satisfaction metrics
   - Response quality tracking

## Files Modified/Created

### New Files
- ✅ `src/services/intentJourneyService.js`
- ✅ `src/services/communicationService.js`
- ✅ `test-communication.js`
- ✅ `test-intent-journey.js`
- ✅ `INTENT_JOURNEY_IMPLEMENTATION.md`

### Modified Files
- ✅ `src/services/geminiService.js` (added method)
- ✅ `src/services/customerService.js` (integrated intent service)
- ✅ `src/routes/customers.js` (added intent field support)
- ✅ `package.json` (added test scripts)
- ✅ `README.md` (added documentation)

## Summary

The intent-based journey system is now fully operational and integrated with the existing RAG system. It provides:

- ✅ Context-aware conversational flows
- ✅ Conversation history management
- ✅ Brand voice consistency
- ✅ Business goal alignment
- ✅ Multi-channel support
- ✅ Full backward compatibility

The system is ready for testing and can be extended with additional intents, database persistence, and external integrations as needed.

