const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const bodyParser = require('body-parser');

// express stuff
const express = require('express');
const app = express();

// parse json
app.use(express.json());
// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Spreadsheet vars
const SHEET_ID = '1vjgyEimvp3pjDc8xEKK7NDWKYVOohROM80n91d4bM7E';
const RANGE = 'Okta Features and SKU (Current)!A1:AK';

// DATA STATIC FOR NOW
let data = [];

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Prints the names and majors of students in a sample spreadsheet:
 * @see https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 * @param {google.auth.OAuth2} auth The authenticated Google OAuth client.
 */
async function listFeatures(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: RANGE,
  });

  let rows = res.data.values;
  if (!rows || rows.length === 0) {
    console.log('No data found.');
    return;
  }

  let num_cols_arr = rows.map((row) => {
    return row.length;
  });
  let max_cols = Math.max(...num_cols_arr);

  const products = {
    IT_PRODUCTS: 'IT Products',
    API_PRODUCTS: 'API Products',
    ADD_ONS: 'Add-on products that can be combined with IT or API Products',
  };

  rows = rows.map((row, row_index) => {
    // Clean up the columns per row so we fill in missing indices
    if (row.length < max_cols) {
      let col_filler = new Array(max_cols - row.length).fill('');
      row = row.concat(col_filler);
    }

    // Determine the appropriate column for the product mapping or sku mapping, etc.
    // Pre-determined parameters:
    // ROW 1 : EDITIONS
    //      COLUMNS D-R : 3-17 = IT Products
    //      COLUMNS T-AF : 19-31 = API Products
    //      COLUMNS AH-AK : 33-36 = Add-on products that can be combined with IT or API Products
    // ROW 3 : SKUS
    //
    // IGNORE FOLLOWING ROWS FOR TERM SEARCH AS THEY ARE SUBSECTIONS:
    // 1 - Complete Feature Matrix for all Products
    // 2 - Red items are new line items added since last major revision \n Orange items are in Early Access
    // 3 - Feature \n For a short description, expand hidden Col A through E with the + button above Col F
    // 4 - Directory
    // 20 - Directory Integration
    // 30 - Administration
    // 44 - Security Reporting and Simple Access Governance
    // 56 - MFA Factors
    // 76 - End-user UI & Customization
    // 92 - Single Sign-On
    // 119 - Policies
    // 120 - User Management Policies
    // 132 - User Access Policies
    // 179 - Lifecycle Orchestration Engine
    // 190 - Provisioning Integrations
    // 204 - Workflows
    // 209 - IGA - Identity Governance / OIG
    // 213 - Mobility Management (Discontinued for new business or upsell)
    // 220 - Developer Tools
    // 225 - API Access Management
    // 240 - Server Access Management
    // 259 - Rate Limits
    // 264 - Core Services
    if (row_index == 0) {
      row = row.map((cell, col) => {
        if (col > 2 && col < 18) {
          cell = products.IT_PRODUCTS;
        } else if (col > 18 && col < 32) {
          cell = products.API_PRODUCTS;
        } else if (col > 32 && col < 37) {
          cell = products.ADD_ONS;
        }
        return cell;
      });
    }

    return row;
  });

  return rows;
}

app.get('/', (request, response) => {
  response.sendFile(path.join(process.cwd(), 'submit.html'));
});

// Sunset this endpoint
app.get('/authorize', async (request, response) => {
  let auth = await authorize();
  let rows = await listFeatures(auth);
  data = rows;
  response.json(rows);
});

// Reinitializes local arr - not the best practice but saves spreadsheet in local data structure
const reAuth = async () => {
    let auth = await authorize();
    let rows = await listFeatures(auth);
    data = rows;
}

app.post('/search', async (request, response) => {
  // Reauth to reinit spreadsheet data
  await reAuth();

  // Search term in request body
  console.log(request.body);
  let search_term = request.body.search;
  // Search rows for term...only first col
  // data[row][col]
  let result_rows = [];
  let ignore_rows = [
    1, 2, 3, 4, 20, 30, 44, 56, 76, 92, 119, 120, 120, 132, 179, 190, 204, 209,
    213, 220, 225, 240, 259, 264,
  ];
  // Redo ignore ignores to be zero indexed
  ignore_rows = ignore_rows.map((row_index) => row_index - 1);
  data.forEach((row, row_index) => {
    // if the row index is not to be ignored
    // if the string at the cell contains the search_term lowercase, add to results
    if (
      !ignore_rows.includes(row_index) &&
      row[0].toLowerCase().includes(search_term)
    ) {
      result_rows.push(row_index);
    }
  });
  // Now I have all the rows for the search term, let's return which SKUs they belong to
  // To do this, for each row, we check all the columns
  // If the column has an X, we return rows 1 and 3 : Edition & SKU
  // Grab the short description and more info links as well. Static at columns 2 and 3
  let final_results = [];
  result_rows.forEach((row_index) => {
    // Feature
    let feature = data[row_index][0];
    // Short Description
    let description = data[row_index][1];
    // Link to more info
    let moreInfoLink = data[row_index][2];
    // Construct the object for the current result row
    let result_object = {}
    result_object[feature] = {};
    result_object[feature]["description"] = description;
    result_object[feature]["moreInfoLink"] = moreInfoLink;
    result_object[feature]["editions_skus"] = []
    for (let col = 3; col < 37; col++) {
      // Found match
      if (data[row_index][col] === 'X') {
        // Edition
        let edition = data[0][col];
        // SKU
        let sku = data[2][col];
        // Add to result obj
        result_object[feature]["editions_skus"].push({ edition, sku });
      }
    }
    // Add obj to result array
    final_results.push(result_object);
  });

  response.send(final_results);
});

// listen for requests :)
const listener = app.listen('3000', () => {
  console.log('Your app is listening on port ' + listener.address().port);
});
