const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const { requireConfig, validateIssueKey } = require('./config');

function getJira() {
  requireConfig(['JIRA_HOST', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);
  const host = process.env.JIRA_HOST.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const client = axios.create({
    baseURL: `https://${host}/rest/api/2`,
    auth: { username: process.env.JIRA_EMAIL, password: process.env.JIRA_API_TOKEN },
    timeout: 30000
  });
  const issuePath = key => `/issue/${encodeURIComponent(validateIssueKey(key))}`;
  return {
    findIssue: key => client.get(issuePath(key)).then(r => r.data),
    addComment: (key, body) => client.post(`${issuePath(key)}/comment`, { body }),
    updateIssue: (key, body) => client.put(issuePath(key), body),
    listFields: () => client.get('/field').then(r => r.data),
    listTransitions: key => client.get(`${issuePath(key)}/transitions`).then(r => r.data),
    transitionIssue: (key, body) => client.post(`${issuePath(key)}/transitions`, body)
  };
}

async function getIssue(issueKey) {
  validateIssueKey(issueKey);
  return getJira().findIssue(issueKey);
}

/**
 * Add a comment to a Jira issue
 */
async function addComment(issueKey, commentText) {
  try {
    await getJira().addComment(issueKey, commentText);
    console.log(`✅ Added comment to ${issueKey}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to add comment to ${issueKey}:`, error.message);
    throw error;
  }
}

/**
 * Update Jira issue fields
 */
async function updateIssueFields(issueKey, fields) {
  try {
    await getJira().updateIssue(issueKey, { fields });
    console.log(`✅ Updated fields for ${issueKey}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to update ${issueKey}:`, error.message);
    throw error;
  }
}

/**
 * Get custom field ID by name
 */
async function getCustomFieldId(fieldName) {
  try {
    const fields = await getJira().listFields();
    const field = fields.find(f => f.name === fieldName);
    return field ? field.id : null;
  } catch (error) {
    console.error('❌ Error getting custom field ID:', error.message);
    return null;
  }
}

/**
 * Update custom fields
 */
async function updateCustomFields(issueKey, customFields) {
  try {
    const fields = {};
    
    for (const [fieldName, value] of Object.entries(customFields)) {
      const customFieldId = await getCustomFieldId(fieldName);
      if (customFieldId) {
        fields[customFieldId] = value;
      } else {
        console.warn(`⚠️  Custom field "${fieldName}" not found`);
      }
    }
    
    if (Object.keys(fields).length > 0) {
      await getJira().updateIssue(issueKey, { fields });
      console.log(`✅ Updated custom fields for ${issueKey}`);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to update custom fields for ${issueKey}:`, error.message);
    throw error;
  }
}

/**
 * Transition issue to a new status
 */
async function transitionIssue(issueKey, statusName) {
  try {
    const transitions = await getJira().listTransitions(issueKey);
    const transition = transitions.transitions.find(
      t => t.name.toLowerCase() === statusName.toLowerCase() || t.to.name.toLowerCase() === statusName.toLowerCase()
    );
    
    if (transition) {
      await getJira().transitionIssue(issueKey, {
        transition: { id: transition.id }
      });
      console.log(`✅ Transitioned ${issueKey} to ${statusName}`);
      return true;
    } else {
      console.warn(`⚠️  Transition to "${statusName}" not available for ${issueKey}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to transition ${issueKey}:`, error.message);
    throw error;
  }
}

/**
 * Upload attachment to Jira issue
 */
async function uploadAttachment(issueKey, filePath, filename) {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), filename);
    
    const auth = Buffer.from(
      `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
    ).toString('base64');
    
    await axios.post(
      `https://${process.env.JIRA_HOST}/rest/api/2/issue/${issueKey}/attachments`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Basic ${auth}`,
          'X-Atlassian-Token': 'no-check'
        }
      }
    );
    
    console.log(`✅ Uploaded attachment ${filename} to ${issueKey}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to upload attachment to ${issueKey}:`, error.message);
    throw error;
  }
}

/**
 * Combined update function
 */
async function updateJiraCard(issueKey, updates) {
  try {
    console.log(`\n📝 Updating Jira card ${issueKey}...`);
    
    // Add comment
    if (updates.comment) {
      await addComment(issueKey, updates.comment);
    }
    
    // Update custom fields
    if (updates.customFields) {
      await updateCustomFields(issueKey, updates.customFields);
    }
    
    // Update standard fields
    if (updates.fields) {
      await updateIssueFields(issueKey, updates.fields);
    }
    
    // Transition status
    if (updates.transition) {
      await transitionIssue(issueKey, updates.transition);
    }
    
    console.log(`✅ Successfully updated ${issueKey}\n`);
    return true;
  } catch (error) {
    console.error(`❌ Error updating ${issueKey}:`, error.message);
    throw error;
  }
}

module.exports = {
  getIssue,
  addComment,
  updateIssueFields,
  updateCustomFields,
  transitionIssue,
  uploadAttachment,
  updateJiraCard,
  getCustomFieldId
};
