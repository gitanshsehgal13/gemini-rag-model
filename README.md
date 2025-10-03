# Gemini RAG System

A personalized RAG system built with Gemini AI that acts as a dedicated personal policy assistant for customers after policy issuance.

## Features

- **Personal Policy Assistant**: Acts as a dedicated personal assistant for each policyholder
- **Post-Issuance Servicing**: Focused on policy servicing after issuance (claims, payments, changes)
- **Personalized Communication**: Uses "with us", "your policy" language for warm, personal interactions
- **Hospital Recommendations**: Comprehensive Mumbai hospital database with network hospitals, emergency care, and location-based search
- **Multimodal Processing**: Handles text documents and images using Gemini 1.5 Pro
- **Document Processing**: PDF, DOCX, TXT, and image file support with intelligent chunking
- **Vector Embeddings**: Advanced similarity search with consistent embedding space
- **Customer-Specific Management**: Isolated policy document storage per customer
- **Conversation Memory**: Maintains context across conversations for natural interactions
- **Multilingual Support**: Responds in the same language as customer queries
- **RESTful API**: Comprehensive Express.js API for integration

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure your API key in `config/constants.js`:
   ```javascript
   // Update the GOOGLE_AI_API_KEY value with your actual API key
   GOOGLE_AI_API_KEY: 'your_actual_api_key_here'
   ```

3. Start the server:
   ```bash
   npm run dev
   ```

> **Note**: All configuration is managed in `config/constants.js` file instead of using `.env` for easier deployment and configuration management.

## API Endpoints

### Customer Endpoints
- **POST** `/api/customers/:customerId/documents` - Upload policy documents
- **POST** `/api/customers/:customerId/query` - Query policy information with intelligent hospital recommendations
- **GET** `/api/customers/:customerId/summary` - Get policy summary
- **GET** `/api/customers/:customerId/suggested-questions` - Get suggested questions
- **GET** `/api/customers/:customerId/documents` - List customer documents
- **GET** `/api/customers/:customerId/hospitals` - Search hospitals (`?type=search&location=andheri&limit=10`)
- **GET** `/api/customers/:customerId/hospitals/emergency` - Get emergency hospitals (`?limit=8`)
- **GET** `/api/customers/:customerId/hospitals/network` - Get network hospitals (`?networkType=Valued&zone=West`)
- **GET** `/api/customers/:customerId/claim-documents/:claimType?` - Get claim document requirements

### Admin Endpoints
- **GET** `/api/admin/health` - System health check with model info
- **GET** `/api/admin/embedding-models` - Get available embedding models
- **PUT** `/api/admin/embedding-models/default` - Set default embedding model
- **PUT** `/api/admin/embedding-models/content-mapping` - Update content type mappings
- **POST** `/api/admin/embedding-models/test` - Test embedding generation

## Usage

Upload policy documents for a customer and then query information about their policies using natural language. The system also provides intelligent hospital recommendations for Mumbai-based customers.

### Query Examples

1. **Policy Information**:
   ```bash
   curl -X POST http://localhost:3000/api/customers/customer123/query \
     -H "Content-Type: application/json" \
     -d '{"query": "What is my premium amount?"}'
   ```

2. **Hospital Recommendations**:
   ```bash
   curl -X POST http://localhost:3000/api/customers/customer123/query \
     -H "Content-Type: application/json" \
     -d '{"query": "show me hospitals near andheri"}'
   ```

3. **Emergency Hospital Search**:
   ```bash
   curl -X POST http://localhost:3000/api/customers/customer123/query \
     -H "Content-Type: application/json" \
     -d '{"query": "I need emergency hospital in west mumbai"}'
   ```

4. **Network Hospital Search**:
   ```bash
   curl -X POST http://localhost:3000/api/customers/customer123/query \
     -H "Content-Type: application/json" \
     -d '{"query": "cashless hospitals in borivali"}'
   ```

5. **Multilingual Queries**:
   ```bash
   curl -X POST http://localhost:3000/api/customers/customer123/query \
     -H "Content-Type: application/json" \
     -d '{"query": "मेरा प्रीमियम कितना है?"}'
   ```

### Hospital Search Features

The system includes comprehensive hospital search capabilities for Mumbai:

- **Location-based Search**: Find hospitals by area name, pincode, or zone
- **Emergency Hospitals**: Get prioritized list of hospitals for emergency care
- **Network Hospitals**: Find cashless treatment hospitals by network type
- **Intelligent Query Detection**: Automatically detects hospital-related queries
- **Complete Coverage**: Database of 342 Mumbai hospitals with network status

**Hospital Query Types Supported**:
- "hospitals near [location]"
- "emergency hospitals"
- "network hospitals"
- "cashless hospitals in [area]"
- "hospitals in [pincode/zone]"
