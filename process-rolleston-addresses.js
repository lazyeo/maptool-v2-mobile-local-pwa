#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Fetch address data from Overpass API for Rolleston area
 */
function fetchOverpassData() {
  return new Promise((resolve, reject) => {
    const overpassQuery = `[timeout:300][bbox:-43.63,172.33,-43.56,172.42];(node[~"addr:.*"~".*"];way[~"addr:.*"~".*"];);out body geom;`;
    
    const postData = overpassQuery;
    
    const options = {
      hostname: 'overpass-api.de',
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 330000 // 330 seconds
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Process and deduplicate address elements
 */
function processAddresses(jsonData) {
  const addressMap = {};
  const addressList = [];
  
  if (!jsonData.elements || !Array.isArray(jsonData.elements)) {
    return { addresses: [], deduplicatedCount: 0, totalElements: 0 };
  }
  
  for (const element of jsonData.elements) {
    if (!element.tags || !element.tags['addr:housenumber']) {
      continue;
    }
    
    // Extract coordinates
    let lat = null;
    let lon = null;
    
    if (element.type === 'node') {
      lat = element.lat;
      lon = element.lon;
    } else if (element.type === 'way' && element.center) {
      lat = element.center.lat;
      lon = element.center.lon;
    } else if (element.nodes && element.geometry) {
      // For ways with geometry, use first node or center
      if (element.geometry.length > 0) {
        lat = element.geometry[0].lat;
        lon = element.geometry[0].lon;
      }
    }
    
    // Build address record
    const addr = {
      id: element.id,
      type: element.type,
      lat: lat,
      lon: lon,
      housenumber: element.tags['addr:housenumber'] || '',
      street: element.tags['addr:street'] || '',
      city: element.tags['addr:city'] || '',
      postcode: element.tags['addr:postcode'] || '',
      suburb: element.tags['addr:suburb'] || '',
      country: element.tags['addr:country'] || 'NZ',
      building: element.tags['building'] || '',
      amenity: element.tags['amenity'] || '',
      shop: element.tags['shop'] || ''
    };
    
    // Build full address for deduplication
    const addressParts = [];
    if (addr.housenumber) addressParts.push(addr.housenumber);
    if (addr.street) addressParts.push(addr.street);
    if (addr.suburb) addressParts.push(addr.suburb);
    if (addr.city) addressParts.push(addr.city);
    if (addr.postcode) addressParts.push(addr.postcode);
    
    const fullAddress = addressParts.join(', ');
    addr.full_address = fullAddress;
    
    // Deduplicate: keep first occurrence or one with most complete data
    if (addressMap[fullAddress]) {
      // Keep the one with more data (more tags filled)
      const existingTagCount = Object.values(addressMap[fullAddress]).filter(v => v && v !== '').length;
      const newTagCount = Object.values(addr).filter(v => v && v !== '').length;
      if (newTagCount > existingTagCount) {
        addressMap[fullAddress] = addr;
      }
    } else {
      addressMap[fullAddress] = addr;
    }
  }
  
  // Convert to array
  for (const addr of Object.values(addressMap)) {
    addressList.push(addr);
  }
  
  return {
    addresses: addressList,
    deduplicatedCount: jsonData.elements.length - addressList.length,
    totalElements: jsonData.elements.length
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('Fetching Rolleston address data from Overpass API...');
  console.log('Bounding box: lat -43.63 to -43.56, lon 172.33 to 172.42');
  console.log('');
  
  try {
    const overpassData = await fetchOverpassData();
    console.log(`✓ Received ${overpassData.elements.length} elements from Overpass API`);
    
    const result = processAddresses(overpassData);
    console.log(`✓ Processed: ${result.addresses.length} unique addresses`);
    console.log(`✓ Deduplicated: ${result.deduplicatedCount} duplicates removed`);
    console.log('');
    
    // Sort by street then housenumber
    result.addresses.sort((a, b) => {
      if (a.street !== b.street) {
        return a.street.localeCompare(b.street);
      }
      // Try numeric comparison for housenumber
      const aNum = parseInt(a.housenumber);
      const bNum = parseInt(b.housenumber);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      return a.housenumber.localeCompare(b.housenumber);
    });
    
    // Save to file
    const outputPath = path.join(__dirname, 'rolleston-addresses.json');
    const output = {
      metadata: {
        source: 'OpenStreetMap (Overpass API)',
        bbox: {
          south: -43.63,
          north: -43.56,
          west: 172.33,
          east: 172.42
        },
        location: 'Rolleston, Selwyn District, Canterbury, New Zealand',
        fetched_at: new Date().toISOString(),
        total_unique_addresses: result.addresses.length,
        elements_processed: result.totalElements,
        duplicates_removed: result.deduplicatedCount
      },
      addresses: result.addresses
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`✓ Saved to: ${outputPath}`);
    console.log('');
    
    // Show sample
    console.log('Sample addresses (first 5):');
    console.log('---');
    for (let i = 0; i < Math.min(5, result.addresses.length); i++) {
      const addr = result.addresses[i];
      console.log(`${i + 1}. ${addr.full_address}`);
      console.log(`   Coordinates: ${addr.lat}, ${addr.lon}`);
      console.log(`   Type: ${addr.type} (ID: ${addr.id})`);
    }
    console.log('');
    console.log(`Total addresses: ${result.addresses.length}`);
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

main();
