const fs = require('fs-extra');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

class DocumentProcessor {
  constructor() {
    this.chunkSize = 1000; // characters per chunk
    this.chunkOverlap = 200; // overlap between chunks
  }

  /**
   * Process a document file and extract text content and images
   * @param {string} filePath - Path to the document file
   * @param {string} fileType - Type of file (pdf, docx, txt, jpg, png, etc.)
   * @returns {Promise<Object>} - Extracted content with text and images
   */
  async processDocument(filePath, fileType) {
    try {
      let result = { text: '', images: [] };
      
      switch (fileType.toLowerCase()) {
        case 'pdf':
          result = await this.processPDF(filePath);
          break;
        case 'docx':
          result = await this.processDOCX(filePath);
          break;
        case 'txt':
          result.text = await this.processTXT(filePath);
          break;
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'webp':
        case 'heic':
        case 'heif':
          result = await this.processImage(filePath, fileType);
          break;
        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }

      if (result.text) {
        result.text = this.cleanText(result.text);
      }

      return result;
    } catch (error) {
      console.error('Error processing document:', error);
      throw error;
    }
  }

  /**
   * Process PDF file and extract text and images
   * @param {string} filePath - Path to PDF file
   * @returns {Promise<Object>} - Extracted text and images
   */
  async processPDF(filePath) {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    
    // Note: For full PDF image extraction, you'd need additional libraries like pdf2pic
    // For now, we'll return text content and note that images are embedded
    const result = {
      text: data.text,
      images: [] // Could be enhanced with pdf2pic or similar
    };

    // Check if PDF likely contains images based on content analysis
    if (this.likelyContainsImages(data.text)) {
      console.log('PDF likely contains images - consider using pdf2pic for full multimodal support');
      result.hasEmbeddedImages = true;
    }

    return result;
  }

  /**
   * Process DOCX file and extract text and images
   * @param {string} filePath - Path to DOCX file
   * @returns {Promise<Object>} - Extracted text and images
   */
  async processDOCX(filePath) {
    const textResult = await mammoth.extractRawText({ path: filePath });
    
    // Extract images from DOCX
    const images = [];
    try {
      const imageResult = await mammoth.images.imgElement(image => {
        return image.read("base64").then(imageBuffer => {
          images.push({
            data: imageBuffer,
            mimeType: `image/${image.contentType || 'jpeg'}`,
            filename: `docx_image_${images.length + 1}.${image.contentType || 'jpg'}`
          });
          return {
            src: `data:image/${image.contentType || 'jpeg'};base64,${imageBuffer}`
          };
        });
      });
      
      await mammoth.convertToHtml({ path: filePath }, { convertImage: imageResult });
    } catch (error) {
      console.warn('Could not extract images from DOCX:', error.message);
    }

    return {
      text: textResult.value,
      images: images
    };
  }

  /**
   * Process image file
   * @param {string} filePath - Path to image file
   * @param {string} fileType - Image file type
   * @returns {Promise<Object>} - Image content for multimodal processing
   */
  async processImage(filePath, fileType) {
    const imageData = await fs.readFile(filePath);
    const mimeType = this.getMimeTypeFromExtension(fileType);
    
    return {
      text: '', // No text content from pure image files
      images: [{
        data: imageData.toString('base64'),
        mimeType: mimeType,
        filename: path.basename(filePath),
        filePath: filePath
      }]
    };
  }

  /**
   * Process TXT file and extract text
   * @param {string} filePath - Path to TXT file
   * @returns {Promise<string>} - Extracted text
   */
  async processTXT(filePath) {
    return await fs.readFile(filePath, 'utf8');
  }

  /**
   * Clean and normalize text content
   * @param {string} text - Raw text content
   * @returns {string} - Cleaned text
   */
  cleanText(text) {
    return text
      .replace(/\s+/g, ' ') // Replace multiple whitespaces with single space
      .replace(/\n+/g, '\n') // Replace multiple newlines with single newline
      .trim();
  }

  /**
   * Split content into chunks for vector processing (supports multimodal)
   * @param {Object|string} content - Content to chunk (text string or multimodal object)
   * @param {string} documentId - Document ID
   * @param {string} customerId - Customer ID
   * @returns {Array<Object>} - Array of content chunks with metadata
   */
  chunkContent(content, documentId, customerId) {
    // Handle backward compatibility - if content is a string, treat as text-only
    if (typeof content === 'string') {
      return this.chunkText(content, documentId, customerId);
    }

    // Handle multimodal content
    const chunks = [];
    let chunkIndex = 0;

    // If there are images, create multimodal chunks
    if (content.images && content.images.length > 0) {
      // Create chunks that combine text with images
      const textChunks = content.text ? this.chunkText(content.text, documentId, customerId) : [];
      
      if (textChunks.length > 0) {
        // Distribute images across text chunks
        const imagesPerChunk = Math.ceil(content.images.length / textChunks.length);
        
        textChunks.forEach((textChunk, index) => {
          const startImageIndex = index * imagesPerChunk;
          const endImageIndex = Math.min(startImageIndex + imagesPerChunk, content.images.length);
          const chunkImages = content.images.slice(startImageIndex, endImageIndex);
          
          chunks.push({
            id: `${documentId}_multimodal_chunk_${chunkIndex}`,
            text: textChunk.text,
            images: chunkImages,
            documentId,
            customerId,
            chunkIndex,
            type: 'multimodal',
            length: textChunk.length,
            imageCount: chunkImages.length
          });
          chunkIndex++;
        });
      } else {
        // No text, create image-only chunks
        content.images.forEach((image, index) => {
          chunks.push({
            id: `${documentId}_image_chunk_${chunkIndex}`,
            text: '',
            images: [image],
            documentId,
            customerId,
            chunkIndex,
            type: 'image-only',
            length: 0,
            imageCount: 1
          });
          chunkIndex++;
        });
      }
    } else if (content.text) {
      // Text-only content
      return this.chunkText(content.text, documentId, customerId);
    }

    return chunks;
  }

  /**
   * Split text into chunks for vector processing (original method)
   * @param {string} text - Text to chunk
   * @param {string} documentId - Document ID
   * @param {string} customerId - Customer ID
   * @returns {Array<Object>} - Array of text chunks with metadata
   */
  chunkText(text, documentId, customerId) {
    const chunks = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let currentChunk = '';
    let chunkIndex = 0;
    
    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;
      
      const potentialChunk = currentChunk + (currentChunk ? '. ' : '') + trimmedSentence;
      
      if (potentialChunk.length <= this.chunkSize) {
        currentChunk = potentialChunk;
      } else {
        // Save current chunk if it has content
        if (currentChunk.trim()) {
          chunks.push({
            id: `${documentId}_chunk_${chunkIndex}`,
            text: currentChunk.trim() + '.',
            documentId,
            customerId,
            chunkIndex,
            length: currentChunk.length
          });
          chunkIndex++;
        }
        
        // Start new chunk with overlap
        const overlapText = this.getOverlapText(currentChunk, this.chunkOverlap);
        currentChunk = overlapText + (overlapText ? '. ' : '') + trimmedSentence;
      }
    }
    
    // Add the last chunk if it has content
    if (currentChunk.trim()) {
      chunks.push({
        id: `${documentId}_chunk_${chunkIndex}`,
        text: currentChunk.trim() + '.',
        documentId,
        customerId,
        chunkIndex,
        length: currentChunk.length
      });
    }
    
    return chunks;
  }

  /**
   * Get overlap text from the end of a chunk
   * @param {string} text - Text to get overlap from
   * @param {number} overlapSize - Size of overlap in characters
   * @returns {string} - Overlap text
   */
  getOverlapText(text, overlapSize) {
    if (text.length <= overlapSize) return text;
    
    const overlapText = text.slice(-overlapSize);
    const lastSentenceStart = overlapText.lastIndexOf('. ');
    
    if (lastSentenceStart !== -1) {
      return overlapText.slice(lastSentenceStart + 2);
    }
    
    return overlapText;
  }

  /**
   * Extract metadata from document content
   * @param {string} text - Document text
   * @param {string} filename - Original filename
   * @returns {Object} - Document metadata
   */
  extractMetadata(text, filename) {
    const metadata = {
      filename,
      wordCount: text.split(/\s+/).length,
      charCount: text.length,
      extractedAt: new Date().toISOString()
    };

    // Try to extract policy-specific information
    const policyNumberMatch = text.match(/policy\s*(?:number|no\.?)\s*:?\s*([A-Z0-9-]+)/i);
    if (policyNumberMatch) {
      metadata.policyNumber = policyNumberMatch[1];
    }

    const policyTypeMatch = text.match(/(?:policy\s*type|type\s*of\s*policy)\s*:?\s*([^.\n]+)/i);
    if (policyTypeMatch) {
      metadata.policyType = policyTypeMatch[1].trim();
    }

    const customerNameMatch = text.match(/(?:insured|policy\s*holder|customer)\s*:?\s*([^.\n]+)/i);
    if (customerNameMatch) {
      metadata.customerName = customerNameMatch[1].trim();
    }

    return metadata;
  }

  /**
   * Check if text content likely contains references to images
   * @param {string} text - Text content to analyze
   * @returns {boolean} - Whether text likely references images
   */
  likelyContainsImages(text) {
    const imageIndicators = [
      'figure', 'chart', 'graph', 'diagram', 'image', 'photo', 'picture',
      'see below', 'shown above', 'illustrated', 'visual', 'screenshot'
    ];
    const lowerText = text.toLowerCase();
    return imageIndicators.some(indicator => lowerText.includes(indicator));
  }

  /**
   * Get MIME type from file extension
   * @param {string} extension - File extension
   * @returns {string} - MIME type
   */
  getMimeTypeFromExtension(extension) {
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'heic': 'image/heic',
      'heif': 'image/heif'
    };
    return mimeTypes[extension.toLowerCase()] || 'image/jpeg';
  }

  /**
   * Extract metadata from multimodal content
   * @param {Object} content - Multimodal content object
   * @param {string} filename - Original filename
   * @returns {Object} - Enhanced metadata
   */
  extractMultimodalMetadata(content, filename) {
    const metadata = {
      filename,
      extractedAt: new Date().toISOString(),
      contentType: 'multimodal',
      hasImages: !!(content.images && content.images.length > 0),
      imageCount: content.images ? content.images.length : 0,
      hasText: !!(content.text && content.text.trim().length > 0)
    };

    if (content.text) {
      metadata.wordCount = content.text.split(/\s+/).length;
      metadata.charCount = content.text.length;
      
      // Extract policy-specific information from text
      const textMetadata = this.extractMetadata(content.text, filename);
      Object.assign(metadata, textMetadata);
    }

    if (content.images && content.images.length > 0) {
      metadata.imageDetails = content.images.map((image, index) => ({
        index,
        filename: image.filename || `image_${index + 1}`,
        mimeType: image.mimeType,
        hasData: !!image.data
      }));
    }

    return metadata;
  }

  /**
   * Validate multimodal content
   * @param {Object} content - Multimodal content to validate
   * @returns {Object} - Validation result
   */
  validateMultimodalContent(content) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: []
    };

    if (!content) {
      validation.isValid = false;
      validation.errors.push('Content is null or undefined');
      return validation;
    }

    if (!content.text && (!content.images || content.images.length === 0)) {
      validation.isValid = false;
      validation.errors.push('Content must have either text or images');
      return validation;
    }

    if (content.images) {
      content.images.forEach((image, index) => {
        if (!image.data && !image.filePath) {
          validation.warnings.push(`Image ${index + 1} has no data or file path`);
        }
        if (!image.mimeType) {
          validation.warnings.push(`Image ${index + 1} has no MIME type specified`);
        }
      });
    }

    return validation;
  }
}

module.exports = DocumentProcessor;
