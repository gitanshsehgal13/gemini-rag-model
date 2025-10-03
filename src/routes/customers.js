const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const router = express.Router();

// Import constants
const CONFIG = require('../../config/constants');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', req.params.customerId);
    await fs.ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname;
    const extension = path.extname(originalName);
    const basename = path.basename(originalName, extension);
    cb(null, `${basename}_${timestamp}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: CONFIG.MAX_FILE_SIZE, // From constants file
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${fileExtension}. Allowed types: ${allowedTypes.join(', ')}`));
    }
  }
});

/**
 * GET /api/customers/:customerId
 * Get customer information
 */
router.get('/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const customerService = req.app.get('customerService');
    
    const customer = customerService.getCustomer(customerId);
    
    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found',
        customerId
      });
    }

    res.json({
      customer,
      documents: customerService.getCustomerDocuments(customerId)
    });
  } catch (error) {
    console.error('Error getting customer:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/:customerId
 * Create or update customer
 */
router.post('/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const customerData = req.body;
    const customerService = req.app.get('customerService');
    
    const customer = await customerService.addCustomer(customerId, customerData);
    
    res.status(201).json({
      message: 'Customer created/updated successfully',
      customer
    });
  } catch (error) {
    console.error('Error creating/updating customer:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/:customerId/documents
 * Get all documents for a customer
 */
router.get('/:customerId/documents', async (req, res) => {
  try {
    const { customerId } = req.params;
    const customerService = req.app.get('customerService');
    
    const customer = customerService.getCustomer(customerId);
    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found',
        customerId
      });
    }

    const documents = customerService.getCustomerDocuments(customerId);
    
    res.json({
      customerId,
      documentCount: documents.length,
      documents
    });
  } catch (error) {
    console.error('Error getting customer documents:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/:customerId/documents
 * Upload and process policy documents (supports multimodal - text + images)
 */
router.post('/:customerId/documents', upload.fields([
  { name: 'document', maxCount: 1 },
  { name: 'images', maxCount: 10 }
]), async (req, res) => {
  try {
    const { customerId } = req.params;
    const customerService = req.app.get('customerService');
    
    const documentFile = req.files?.document?.[0];
    const imageFiles = req.files?.images || [];
    
    if (!documentFile && imageFiles.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded. Please upload at least a document or images.'
      });
    }

    // Ensure customer exists, create if not
    let customer = customerService.getCustomer(customerId);
    if (!customer) {
      const customerData = {
        name: req.body.customerName || `Customer ${customerId}`,
        email: req.body.customerEmail || null
      };
      customer = await customerService.addCustomer(customerId, customerData);
    }

    let result;
    const filesToCleanup = [];

    try {
      if (documentFile && imageFiles.length === 0) {
        // Single document upload (traditional flow)
        result = await customerService.processDocument(
          customerId,
          documentFile.path,
          documentFile.originalname
        );
        filesToCleanup.push(documentFile.path);
      } else if (imageFiles.length > 0 && !documentFile) {
        // Image-only upload
        result = await customerService.processMultimodalDocument(
          customerId,
          null, // No primary document
          imageFiles,
          req.body.description || 'Image-only policy document'
        );
        filesToCleanup.push(...imageFiles.map(f => f.path));
      } else {
        // Multimodal document (document + images)
        result = await customerService.processMultimodalDocument(
          customerId,
          documentFile,
          imageFiles,
          req.body.description
        );
        filesToCleanup.push(documentFile.path, ...imageFiles.map(f => f.path));
      }

      // Clean up uploaded files
      for (const filePath of filesToCleanup) {
        await fs.remove(filePath);
      }

      res.status(201).json({
        message: 'Document(s) processed successfully',
        result
      });
    } catch (error) {
      // Clean up files on error
      for (const filePath of filesToCleanup) {
        try {
          await fs.remove(filePath);
        } catch (cleanupError) {
          console.error('Error cleaning up file:', cleanupError);
        }
      }
      throw error;
    }
  } catch (error) {
    console.error('Error processing document:', error);
    
    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      try {
        await fs.remove(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * DELETE /api/customers/:customerId/documents/:documentId
 * Delete a customer's document
 */
router.delete('/:customerId/documents/:documentId', async (req, res) => {
  try {
    const { customerId, documentId } = req.params;
    const customerService = req.app.get('customerService');
    
    const success = await customerService.deleteDocument(customerId, documentId);
    
    if (!success) {
      return res.status(404).json({
        error: 'Document not found or access denied',
        customerId,
        documentId
      });
    }

    res.json({
      message: 'Document deleted successfully',
      customerId,
      documentId
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/customers/:customerId/query
 * Query customer's policy documents
 */
router.post('/:customerId/query', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { query, options = {} } = req.body;
    const customerService = req.app.get('customerService');
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Query is required and must be a string'
      });
    }

    const customer = customerService.getCustomer(customerId);
    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found',
        customerId
      });
    }

    const response = await customerService.queryDocuments(customerId, query, options);
    
    res.json({
      customerId,
      query,
      ...response
    });
  } catch (error) {
    console.error('Error querying documents:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/:customerId/summary
 * Get policy summary for a customer
 */
router.get('/:customerId/summary', async (req, res) => {
  try {
    const { customerId } = req.params;
    const customerService = req.app.get('customerService');
    
    const customer = customerService.getCustomer(customerId);
    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found',
        customerId
      });
    }

    const summary = await customerService.getPolicySummary(customerId);
    
    res.json({
      customerId,
      ...summary
    });
  } catch (error) {
    console.error('Error getting policy summary:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/:customerId/suggested-questions
 * Get suggested questions for a customer
 */
router.get('/:customerId/suggested-questions', async (req, res) => {
  try {
    const { customerId } = req.params;
    const customerService = req.app.get('customerService');
    
    const customer = customerService.getCustomer(customerId);
    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found',
        customerId
      });
    }

    const questions = await customerService.getSuggestedQuestions(customerId);
    
    res.json({
      customerId,
      suggestedQuestions: questions
    });
  } catch (error) {
    console.error('Error getting suggested questions:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/customers/:customerId/policy-timeline
 * Get policy timeline data
 */
router.get('/:customerId/policy-timeline', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const timelineFilePath = path.join(__dirname, '../../data/policyTimeline.json');
    
    // Check if file exists
    if (!fs.existsSync(timelineFilePath)) {
      return res.status(404).json({
        error: 'Policy timeline data not found'
      });
    }
    
    // Read and parse the timeline data
    const timelineData = JSON.parse(fs.readFileSync(timelineFilePath, 'utf8'));
    
    res.json({
      customerId: req.params.customerId,
      ...timelineData
    });
    
  } catch (error) {
    console.error('Error fetching policy timeline:', error);
    res.status(500).json({ 
      error: 'Failed to fetch policy timeline data',
      details: error.message
    });
  }
});

module.exports = router;
