const axios = require('axios');

/**
 * Claim Initiation Service
 * Handles claim initiation API calls to Tata AIG
 */
class ClaimInitiationService {
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || 'https://alpha10bn.tataaig.com/servicing/api/health/claims/initiate-claim';
    this.authToken = config.authToken || '11cdae4d25d2d77bfa2372f06a889c74:b6278f85d82403fd1853b516e7bada1303ff7627916ee47e07d0259c1cc2688a839901fbb51ab7557fd5c9d4c97f78de44bd4da51fba1e89bfa6e6685980370f1e42b01a12866c5bb25d64cfff2a43fafad3bc2274a3506bf563bebdc93e4d82a32c9f3ce821905cb4a2dba4616ef3cb172f062cf28fea9f18e4d966b5087630c460cc1610f4c5583665536e3113d497b740086da110d006994f73baf5373cd004aaee51c38c22bed2c88b124a7aaa35bfd9bf66cf9a122c858e2e795336a137d7290caac43c338108b7f09d8f7734e1cfef9739ff3d45de301016ca0301882594c59356a12c7c20cf06e769bc67329c2016c471659854ffc9af73434f1e64b2a906bb7c09b46e84216d0d5500e2eae129a8ca3a3632dc56427a235bb36e7fb65ebb2c481c3d9c22cfddbf3ed53e1a62ef3468b0014f163afa804cb40b9ce2dcfc29f8405eee44efc02452fb17e6355b587ce83344214719c9f1a5f5bd9e7c0ff206d6c246b792819bc15bb925ef95bdab64c4e2654f4274ae778cd479391eeccbbc48562a8c558a7d66ef301117b20e844245356e4c7a51422e77110aec615d5cd434362141a00d582b0345450d665c407a35c796113f94be7de680e5739caa6079e67b84f1b89dba6b3eff0dae241c65f111bf9b75ae415ef8b945f6fe2b27e9201a5a8da70ba194262c6c4ed44f831e2d7ca170d42146f990d4b0ac3e72d41072e3520c10927a7bcf7f3333f932a972e46790d42929d05865c81a65b645df18989b99aa65a9eee776115a3f618473828305e212a9e227d34cdd9a0b193051397aa4e84d8f4688e1710a6674b3610ec84ee8126f0a628613d27259120210b7a9e839e6cec0a6f8823046c91991fcbf0465eb3b98067bc6a7ba01ed7488036a5037adc25eb1bc1b5a3fbce16eb7ba1f70ea614f29a524b430bf5b03f7d8b1100c51f58b9f2e7046f7270ef961ba4f79';
  }

  /**
   * Initiate a claim
   * @param {Object} claimData - Claim data object
   * @returns {Promise<Object>} - API response
   */
  async initiateClaim(claimData) {
    const {
      // User inputs
      dateOfAdmission,
      diagnosis,
      estimatedCost,
      
      // Policy data
      policyNumber,
      memberFirstName,
      memberLastName,
      memberDob,
      memberGender,
      memberRelation,
      memberUHID,
      mobileNumber,
      emailId,
      communicationAddress,
      communicationCity,
      communicationPincode,
      
      // Hospital data (user selected)
      hospitalName,
      hospitalAddress,
      hospitalAddressLine2,
      hospitalCityTownVillage,
      hospitalDistrict,
      hospitalState,
      hospitalPincode,
      hospitalCountry
    } = claimData;

    // Calculate discharge date (admission date + 2 days)
    const dateOfDischarge = this.calculateDischargeDate(dateOfAdmission);

    // Build the payload
    const payload = {
      // Static fields
      benefitClaim: "false",
      certificateNumber: "",
      coverCode: "",
      estimatedDays: "2",
      hospitalEmailId: "",
      hospitalMobileNo: "",
      hospitalStatus: "PRN Generated",
      isCAG: true,
      isCashlessPayment: "Not Chosen",
      isCreatedFromClaimIntimation: "true",
      isExcludedProvider: "false",
      isExistingProvider: false,
      isHospitalManualEntry: "No",
      isPrePostClaim: false,
      policyDetailsProposerNameFirstName: "",
      policyDetailsProposerNameLastName: "",
      policyDetailsProposerNameMiddleName: "",
      policyTypeForClaim: "Retail",
      prn: "PRN1021142",
      producerAlternateEmail: "UATRETAILHEALTH@TATAAIG.COM",
      producerEmail: "",
      rohiniId: "8900080014039",
      secondOpinion: "false",
      source: "SPA",
      subSource: "MobileApp",
      tpaCode: "1000000023",
      typeOfClaim: "Cashless",
      utmCampaign: "",
      utmMedium: "",
      utmSource: "",
      
      // Dynamic fields from policy data
      communicationAddress: communicationAddress || "",
      communicationCity: communicationCity || "",
      communicationPincode: communicationPincode || "",
      emailId: emailId || "",
      memberDob: memberDob || "",
      memberFirstName: memberFirstName || "",
      memberGender: memberGender || "",
      memberLastName: memberLastName || "",
      memberRelation: memberRelation || "",
      memberUHID: memberUHID || "",
      mobileNumber: mobileNumber || "",
      policyNumber: policyNumber || "",
      
      // User input fields
      dateOfAdmission: dateOfAdmission || "",
      dateOfDischarge: dateOfDischarge || "",
      diagnosis: diagnosis || "",
      illness: diagnosis || "", // Same as diagnosis
      estimatedCost: estimatedCost || "",
      
      // Hospital data (user selected)
      hospitalAddress: hospitalAddress || "",
      hospitalAddressLine2: hospitalAddressLine2 || "",
      hospitalCityTownVillage: hospitalCityTownVillage || "",
      hospitalCountry: hospitalCountry || "INDIA",
      hospitalDistrict: hospitalDistrict || "",
      hospitalName: hospitalName || "",
      hospitalPincode: hospitalPincode || "",
      hospitalState: hospitalState || ""
    };

    console.log('Initiating claim with payload:', JSON.stringify(payload, null, 2));

    // Retry logic for network issues
    const maxRetries = 3;
    const retryDelay = 10000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Making API call (attempt ${attempt}/${maxRetries})...`);
        
        const response = await axios.post(this.apiEndpoint, payload, {
          headers: {
            'accept-version': '2.0.0',
            'Content-Type': 'application/json',
            'x-client': 'android',
            'platform': 'android',
            'X-App-Version': '4.1.2-debug',
            'x-build-number': '2025100802',
            'X-User-ID': '6703cfc70ad5a990e3d1f197',
            'Authorization': `Bearer ${this.authToken}`
          },
          timeout: 30000 // 30 second timeout
        });

        console.log('Claim initiated successfully:', response.data);
        return {
          success: true,
          data: response.data
        };

      } catch (error) {
        console.error(`Claim initiation attempt ${attempt} failed:`, error.response?.data || error.message);
        
        // Check if it's a retryable error
        const isRetryableError = 
          error.code === 'ECONNABORTED' || // Timeout
          error.code === 'ENOTFOUND' ||   // DNS resolution failed
          error.code === 'ECONNREFUSED' || // Connection refused
          error.code === 'ETIMEDOUT' ||   // Connection timeout
          error.response?.status === 504 || // Gateway timeout
          error.response?.status === 502 || // Bad gateway
          error.response?.status === 503 || // Service unavailable
          (error.response?.data && typeof error.response.data === 'string' && error.response.data.includes('504 Gateway Timeout'));

        if (isRetryableError && attempt < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // Final attempt failed or non-retryable error
        console.error('Claim initiation failed after all retries:', error.response?.data || error.message);
        return {
          success: false,
          error: error.response?.data || { 
            message: error.message,
            code: error.code,
            status: error.response?.status
          }
        };
      }
    }
  }

  /**
   * Calculate discharge date (admission date + 2 days)
   * @param {string} admissionDate - Admission date in DD-MM-YYYY format
   * @returns {string} - Discharge date in DD-MM-YYYY format
   */
  calculateDischargeDate(admissionDate) {
    try {
      // Parse DD-MM-YYYY format
      const parts = admissionDate.split('-');
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
      const year = parseInt(parts[2], 10);
      
      const date = new Date(year, month, day);
      
      // Add 2 days
      date.setDate(date.getDate() + 2);
      
      // Format back to DD-MM-YYYY
      const newDay = String(date.getDate()).padStart(2, '0');
      const newMonth = String(date.getMonth() + 1).padStart(2, '0');
      const newYear = date.getFullYear();
      
      return `${newDay}-${newMonth}-${newYear}`;
    } catch (error) {
      console.error('Error calculating discharge date:', error);
      return admissionDate; // Return original if error
    }
  }

  /**
   * Build claim data from policy info and user inputs
   * @param {Object} policyInfo - Policy information
   * @param {Object} userInputs - User provided inputs
   * @param {Object} hospitalData - Selected hospital data
   * @returns {Object} - Complete claim data object
   */
  buildClaimData(policyInfo, userInputs, hospitalData) {
    // Find the member who needs admission
    let member = null;
    if (userInputs.memberRelation) {
      member = policyInfo.insuredMembers?.find(m => 
        m.relationship.toLowerCase() === userInputs.memberRelation.toLowerCase()
      );
    }
    
    if (!member && policyInfo.insuredMembers && policyInfo.insuredMembers.length > 0) {
      member = policyInfo.insuredMembers[0]; // Default to first member
    }

    return {
      // User inputs
      dateOfAdmission: userInputs.dateOfAdmission,
      diagnosis: userInputs.diagnosis,
      estimatedCost: userInputs.estimatedCost,
      
      // Policy data
      policyNumber: policyInfo.policyNumber,
      memberFirstName: member?.name.split(' ')[0] || '',
      memberLastName: member?.name.split(' ').slice(1).join(' ') || '',
      memberDob: member?.dob ? this.formatDateForAPI(member.dob) : '',
      memberGender: userInputs.memberGender || 'Female',
      memberRelation: member?.relationship || 'Self',
      memberUHID: member?.memberId || '',
      mobileNumber: userInputs.mobileNumber || '9830323302',
      emailId: userInputs.emailId || 'customer@example.com',
      communicationAddress: userInputs.communicationAddress || '',
      communicationCity: userInputs.communicationCity || '',
      communicationPincode: userInputs.communicationPincode || '',
      
      // Hospital data
      hospitalName: hospitalData?.hospitalName || '',
      hospitalAddress: hospitalData?.hospitalAddress || '',
      hospitalAddressLine2: hospitalData?.city || '',
      hospitalCityTownVillage: hospitalData?.city || '',
      hospitalDistrict: hospitalData?.zone || '',
      hospitalState: hospitalData?.state || '',
      hospitalPincode: hospitalData?.pincode || '',
      hospitalCountry: 'INDIA'
    };
  }

  /**
   * Format date from "DD MMM YYYY" to "YYYY-MM-DD HH:mm:ss"
   * @param {string} dateStr - Date string like "15 Jun 1988"
   * @returns {string} - Formatted date
   */
  formatDateForAPI(dateStr) {
    try {
      const monthMap = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
      };
      
      const parts = dateStr.split(' ');
      const day = parts[0];
      const month = monthMap[parts[1]];
      const year = parts[2];
      
      return `${year}-${month}-${day} 00:00:00`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return dateStr;
    }
  }
}

module.exports = ClaimInitiationService;

