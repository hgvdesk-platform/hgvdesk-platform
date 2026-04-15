const API_KEY = '13940e4c045e4b2691354522b103d7be';
const BASE = 'http://localhost:3000';

const TEST_ORG = {
  email: 'admin@hgvmanager.co.uk',
  password: 'ChangeMe123!', // NOSONAR — test fixture, not a real credential
  company: 'HGV Manager',
  apiKey: API_KEY,
};

const TEST_VEHICLE = {
  reg: 'TE71 EST',
  make: 'DAF',
  model: 'XF',
  year: '2021',
  motExpiry: '2027-04-15',
};

const TEST_CUSTOMER = {
  name: 'Test Logistics Ltd',
  email: 'fleet@testlogistics.co.uk',
  phone: '01234 567890',
};

const TEST_TECHNICIAN = {
  name: 'Test Technician',
};

const TEST_PART = {
  name: 'Air Filter',
  cost: '45.00',
  quantity: '2',
};

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
  };
}

module.exports = {
  API_KEY, BASE, TEST_ORG, TEST_VEHICLE,
  TEST_CUSTOMER, TEST_TECHNICIAN, TEST_PART, apiHeaders,
};
