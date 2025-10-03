const fs = require('fs');
const path = require('path');

class ClaimDocumentService {
  constructor() {
    this.claimDocuments = null;
    this.loadClaimDocuments();
  }

  /**
   * Load claim documents from JSON file
   */
  loadClaimDocuments() {
    try {
      const filePath = path.join(__dirname, '../../data/claimDocuments.json');
      const data = fs.readFileSync(filePath, 'utf8');
      this.claimDocuments = JSON.parse(data);
    } catch (error) {
      console.error('Error loading claim documents:', error);
      this.claimDocuments = null;
    }
  }

  /**
   * Get formatted document list for reimbursement claims
   * @returns {string} - Formatted document list with mandatory indicators
   */
  getReimbursementDocumentList() {
    if (!this.claimDocuments || !this.claimDocuments.documentList) {
      return 'Document list not available. Please contact our team for specific document requirements.';
    }

    let documentList = 'Here are the documents you\'ll need for your reimbursement claim:\n\n';

    this.claimDocuments.documentList.forEach(category => {
      documentList += `**${category.customerDocumentCategory}:**\n`;
      
      category.documents.forEach(doc => {
        const mandatoryIndicator = doc.isMandatory ? ' *' : '';
        documentList += `• ${doc.customerDocumentName}${mandatoryIndicator}\n`;
      });
      
      documentList += '\n';
    });

    documentList += '*Required documents (marked with *)';
    
    return documentList;
  }

  /**
   * Get mandatory documents only
   * @returns {Array} - Array of mandatory document names
   */
  getMandatoryDocuments() {
    if (!this.claimDocuments || !this.claimDocuments.documentList) {
      return [];
    }

    const mandatoryDocs = [];
    
    this.claimDocuments.documentList.forEach(category => {
      category.documents.forEach(doc => {
        if (doc.isMandatory) {
          mandatoryDocs.push(doc.customerDocumentName);
        }
      });
    });

    return mandatoryDocs;
  }

  /**
   * Get documents by category
   * @param {string} categoryName - Category name to filter by
   * @returns {Array} - Array of documents in the category
   */
  getDocumentsByCategory(categoryName) {
    if (!this.claimDocuments || !this.claimDocuments.documentList) {
      return [];
    }

    const category = this.claimDocuments.documentList.find(
      cat => cat.customerDocumentCategory.toLowerCase().includes(categoryName.toLowerCase())
    );

    return category ? category.documents : [];
  }

  /**
   * Check if document list is available
   * @returns {boolean} - Whether document list is loaded
   */
  isDocumentListAvailable() {
    return this.claimDocuments && this.claimDocuments.documentList && this.claimDocuments.isActive;
  }

  /**
   * Get formatted document checklist for specific categories
   * @param {Array} categories - Array of category names to include
   * @returns {string} - Formatted document checklist
   */
  getDocumentChecklist(categories = []) {
    if (!this.claimDocuments || !this.claimDocuments.documentList) {
      return 'Document checklist not available.';
    }

    let checklist = '';
    
    if (categories.length === 0) {
      // Return all categories
      return this.getReimbursementDocumentList();
    }

    categories.forEach(categoryName => {
      const category = this.claimDocuments.documentList.find(
        cat => cat.customerDocumentCategory.toLowerCase().includes(categoryName.toLowerCase())
      );

      if (category) {
        checklist += `**${category.customerDocumentCategory}:**\n`;
        
        category.documents.forEach(doc => {
          const mandatoryIndicator = doc.isMandatory ? ' *' : '';
          checklist += `• ${doc.customerDocumentName}${mandatoryIndicator}\n`;
        });
        
        checklist += '\n';
      }
    });

    if (checklist) {
      checklist += '*Required documents (marked with *)';
    }

    return checklist || 'No documents found for the specified categories.';
  }
}

module.exports = ClaimDocumentService;
