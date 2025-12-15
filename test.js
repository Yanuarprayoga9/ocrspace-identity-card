const axios = require('axios');
const fs = require('fs');

/**
 * Test script untuk KTP NIK Extractor API
 */

const API_URL = 'http://localhost:3000';

// Sample base64 image (1x1 pixel red image for testing)
const SAMPLE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function testHealthCheck() {
  console.log('\n📋 Testing Health Check...');
  try {
    const response = await axios.get(`${API_URL}/health`);
    console.log('✅ Health Check:', response.data);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testExtractNIKBase64() {
  console.log('\n📷 Testing Extract NIK with Base64...');
  try {
    const response = await axios.post(`${API_URL}/extract-nik`, {
      image: `data:image/png;base64,${SAMPLE_BASE64}`,
      type: 'base64'
    });
    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

async function testDocumentation() {
  console.log('\n📚 Testing API Documentation...');
  try {
    const response = await axios.get(API_URL);
    console.log('✅ Documentation:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting API Tests...');
  console.log(`API URL: ${API_URL}`);
  
  await testHealthCheck();
  await testDocumentation();
  await testExtractNIKBase64();
  
  console.log('\n✨ Tests completed!');
}

runTests().catch(console.error);
