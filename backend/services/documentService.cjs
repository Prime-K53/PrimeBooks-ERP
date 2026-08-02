const path = require('path');
const fs = require('fs');
const { getDatabase } = require('../db.cjs');
const getDb = () => getDatabase();
const { detectIdentifierType, ResolutionError } = require('./resolverUtils.cjs');
const { LayoutEngine } = require('../../frontend/services/layoutEngine.cjs');
const { ConsistencyService } = require('../../frontend/services/consistencyService.cjs');

// PDF Generation with Puppeteer
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (err) {
  console.warn('[DocumentService] Puppeteer not available:', err.message);
}

/**
 * DocumentService handles the lifecycle of documents in the ERP.
 * It integrates the layout engine and consistency checks.
 */
class DocumentService {
  constructor() {
    this.layoutEngine = new LayoutEngine();
    this.consistencyService = new ConsistencyService();
    this.memoryRepository = new Map();
    this._memKey = (id) => `${id}`;
  }

  /**
   * Resolves a document from either the persistent store or the in-memory repository.
   * Supports both internal UUIDs and display IDs with context-aware rules.
   */
  async resolveDocument(id, options = {}) {
    const defaultOptions = { includeInMemory: true, allowLogicalFallback: true, purpose: 'general' };
    const mergedOptions = { ...defaultOptions, ...options };
    const identifierType = detectIdentifierType(id);
    console.log(`[DocumentService] Resolving document ${id}...`, { identifierType, options: mergedOptions });

    const memKey = this._memKey(id);

    if (mergedOptions.includeInMemory && this.memoryRepository.has(memKey)) {
      const doc = this.memoryRepository.get(memKey);

      if (doc.status === 'voided') {
        const diag = `[ID: ${id}] [Stage: Resolution] [Lifecycle: voided] Cannot resolve a voided document.`;
        throw new ResolutionError(`Document ${id} is voided and cannot be resolved.`, id, identifierType, diag, "ACCESS_DENIED");
      }

      console.log(`[DocumentService] Document ${id} resolved from in-memory repository.`);
      return doc;
    }

    // 2. Check persistent store
    return new Promise((resolve, reject) => {
      let query;
      let params;

      if (identifierType === 'internalId') {
        query = "SELECT * FROM documents WHERE id = ?";
        params = [id];
      } else if (identifierType === 'logicalNumber' && mergedOptions.allowLogicalFallback) {
        query = "SELECT * FROM documents WHERE logical_number = ?";
        params = [id];
      } else {
        console.warn(`[DocumentService] Invalid identifier format or fallback disabled: ${id}`);
        return resolve(null);
      }

      getDb().get(query, params, (err, doc) => {
        if (err) {
          console.error(`[DocumentService] Database error during resolution of ${id}:`, err);
          return reject(err);
        }
        
        if (!doc) {
          console.warn(`[DocumentService] Document ${id} not found in persistent store.`);
          return resolve(null);
        }

        // Policy Rules:
        // - VOID documents are never resolvable
        if (doc.status === 'voided') {
          const diag = `[ID: ${id}] [Stage: DB_Resolution] [Lifecycle: voided] Persistent resolution failed. The document has been voided and is no longer accessible via standard resolution pipelines.`;
          return reject(new ResolutionError(
            `Document ${id} is voided and cannot be resolved.`,
            id,
            identifierType,
            diag,
            "ACCESS_DENIED"
          ));
        }

        // - internalId can resolve DRAFT and FINAL documents (already covered by fetching anything not voided)
        // - logicalNumber resolves FINAL documents by default
        // - logicalNumber resolves DRAFT documents only when the purpose is "preview"
        if (identifierType === 'logicalNumber' && doc.status === 'draft' && mergedOptions.purpose !== 'preview') {
          const diag = `[ID: ${id}] [Stage: DB_Resolution] [Lifecycle: draft] Access Denied: Logical number '${id}' refers to a DRAFT document. DRAFTs can only be resolved via logical number when explicitly requested with 'preview' purpose to prevent accidental use of non-finalized data.`;
          return reject(new ResolutionError(
            `Access Denied: Cannot resolve DRAFT document via logical number without preview context.`,
            id,
            identifierType,
            diag,
            "CONTEXT_REQUIRED"
          ));
        }

        console.log(`[DocumentService] Document ${id} resolved via ${identifierType} (Status: ${doc.status}).`);
        resolve({
          ...doc,
          payload: typeof doc.payload === 'string' ? JSON.parse(doc.payload) : doc.payload,
          render_model: doc.render_model ? (typeof doc.render_model === 'string' ? JSON.parse(doc.render_model) : doc.render_model) : null,
          source: 'persistent'
        });
      });
    });
  }

  /**
   * Register or Upsert a document.
   * Ensures the document exists in the repository before further operations (like preview).
   */
  async registerDocument(type, payload, userId, existingId = null) {
    if (existingId) {
      const identifierType = detectIdentifierType(existingId);
      
      // If it's a logical number, we need to find the internal ID first
      let internalId = existingId;
      if (identifierType === 'logicalNumber') {
        const doc = await this.resolveDocument(existingId, { allowLogicalFallback: true, purpose: 'general' });
        if (doc) {
          internalId = doc.id;
        } else {
          // If logical number doesn't exist, treat as new creation with that type
          return this.createDocument(type, payload, userId);
        }
      }

      try {
        await this.updateDocument(internalId, payload, userId);
        const doc = await this.resolveDocument(internalId);
        return { 
          id: doc.id, 
          logicalNumber: doc.logical_number, 
          type: doc.type, 
          status: doc.status,
          isNew: false 
        };
      } catch (err) {
        if (err.message === 'Document not found') {
          return this.createDocument(type, payload, userId);
        }
        throw err;
      }
    } else {
      const result = await this.createDocument(type, payload, userId);
      return { ...result, isNew: true };
    }
  }

  /**
   * Create a new document in draft status.
   */
  async createDocument(type, payload, userId) {
    // Generate a proper UUID for internal tracking, alongside the display ID
    const uuid = require('crypto').randomUUID();
    const displayId = `${type.toUpperCase()}-${Date.now()}`;
    
    const query = `
      INSERT INTO documents (id, logical_number, type, status, payload, created_by)
      VALUES (?, ?, ?, 'draft', ?, ?)
    `;
    
    return new Promise((resolve, reject) => {
      const params = [uuid, displayId, type, JSON.stringify(payload), userId];
      getDb().run(query, params, function(err) {
        if (err) return reject(err);
        resolve({ id: uuid, logicalNumber: displayId, type, status: 'draft' });
      });
    });
  }

  /**
   * Update an existing draft document.
   */
  async updateDocument(id, payload, userId) {
    return new Promise((resolve, reject) => {
      // 1. Check if document exists and is in draft status
      getDb().get("SELECT status FROM documents WHERE id = ?", [id], (err, doc) => {
        if (err) return reject(err);
        if (!doc) return reject(new Error('Document not found'));
        if (doc.status !== 'draft') {
          return reject(new Error(`Cannot edit document in ${doc.status} status`));
        }

        // 2. Perform update
        const query = `
          UPDATE documents 
          SET payload = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?`;
        getDb().run(query, [JSON.stringify(payload), id], (err) => {
          if (err) return reject(err);
          resolve({ id, success: true });
        });
      });
    });
  }

  /**
   * Finalize a document: Generate layout, lock it, and transition to 'finalized'.
   */
  async finalizeDocument(id, layoutBlueprint, userId) {
    return new Promise((resolve, reject) => {
      getDb().get("SELECT * FROM documents WHERE id = ?", [id], async (err, doc) => {
        if (err) return reject(err);
        if (!doc) return reject(new Error('Document not found'));
        if (doc.status !== 'draft') {
          return reject(new Error(`Document is already ${doc.status}`));
        }

        try {
          const payload = JSON.parse(doc.payload);
          
          // 1. Generate Render Model (Bind data then generate layout)
          const boundBlueprint = this.layoutEngine.calculate(payload, layoutBlueprint);
          const renderModel = this.layoutEngine.generate(boundBlueprint);
          
          // 2. Add Security & Finalize
          renderModel.security = {
            ...renderModel.security,
            isFinalized: true,
            signature: {
              signerName: userId,
              signedAt: new Date().toISOString(),
              hash: this.consistencyService.generateFingerprint(renderModel)
            }
          };

          // 3. Validate and Fingerprint
          const validation = this.consistencyService.validate(renderModel);
          if (!validation.isValid) {
            return reject(new Error(`Layout validation failed: ${validation.errors.join(', ')}`));
          }

          // 4. Persist Finalized State
          const query = `
            UPDATE documents 
            SET status = 'finalized', 
                render_model = ?, 
                fingerprint = ?, 
                finalized_at = CURRENT_TIMESTAMP 
            WHERE id = ?`;
          getDb().run(query, [JSON.stringify(renderModel), validation.fingerprint, id], (err) => {
            if (err) return reject(err);
            resolve({ id, status: 'finalized', fingerprint: validation.fingerprint });
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Batch Process: Finalize multiple documents at once.
   */
  async batchFinalize(ids, blueprint, userId) {
    const results = [];
    for (const id of ids) {
      try {
        const result = await this.finalizeDocument(id, blueprint, userId);
        results.push({ id, success: true, fingerprint: result.fingerprint });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }
    return results;
  }

  /**
   * Batch Export: Exports multiple documents.
   */
  async batchExport(ids) {
    const results = [];
    for (const id of ids) {
      try {
        const exportResult = await this.exportPdf(id);
        results.push({
          id,
          success: true,
          data: exportResult
        });
      } catch (err) {
        results.push({
          id,
          success: false,
          error: err.message
        });
      }
    }
    return results;
  }

  /**
   * Verify the digital signature of a document.
   */
  async verifySignature(id) {
    return new Promise((resolve, reject) => {
      getDb().get("SELECT render_model, fingerprint FROM documents WHERE id = ?", [id], (err, doc) => {
        if (err) return reject(err);
        if (!doc) return reject(new Error('Document not found'));
        if (!doc.fingerprint) return reject(new Error('Document is not finalized/signed'));

        try {
          const renderModel = JSON.parse(doc.render_model);
          const currentFingerprint = this.consistencyService.generateFingerprint(renderModel);
          
          const isValid = currentFingerprint === doc.fingerprint;
          const signature = renderModel.security?.signature;

          resolve({
            isValid,
            signer: signature?.signerName,
            signedAt: signature?.signedAt,
            fingerprint: doc.fingerprint
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  async voidDocument(id, userId) {
    return new Promise((resolve, reject) => {
      getDb().run("UPDATE documents SET status = 'voided' WHERE id = ?", [id], (err) => {
        if (err) return reject(err);
        resolve({ id, status: 'voided' });
      });
    });
  }

  /**
   * Get the render model for preview with a guarded flow.
   */
  async getPreview(id, options = { purpose: 'preview', templateId: null }) {
    const identifierType = detectIdentifierType(id);
    try {
      // 0. Resolve the document using the shared resolution logic with purpose
      const doc = await this.resolveDocument(id, { 
        includeInMemory: true, 
        allowLogicalFallback: true,
        purpose: options.purpose 
      });
      
      if (!doc) {
        const diag = `[ID: ${id}] [Stage: Resolution] [Lifecycle: unknown] The identifier '${id}' could not be matched against any registered document. Ensure the document was successfully registered before attempting to preview.`;
        throw new ResolutionError(
          `Document not found.`,
          id,
          identifierType,
          diag
        );
      }

      // 1. Verify status is FINAL (finalized) or allowed for draft preview if specifically requested
      // POLICY UPDATE: internalId can resolve DRAFT and FINAL. 
      // logicalNumber resolves DRAFT only when purpose is "preview".
      // We already handle VOID rejection in resolveDocument.
      const isAllowedDraftPreview = doc.status === 'draft' && options.purpose === 'preview';
      
      if (doc.status !== 'finalized' && !isAllowedDraftPreview) {
        const diag = `[ID: ${id}] [Stage: Validation] [Lifecycle: ${doc.status}] Preview Blocked. Document is in '${doc.status}' state. Only 'finalized' documents or DRAFTs with an active 'preview' purpose session are eligible for rendering.`;
        throw new ResolutionError(
          `Preview Blocked: Document status is '${doc.status}'.`,
          id,
          identifierType,
          diag,
          "ACCESS_DENIED"
        );
      }

      // 2. Check that a layout blueprint exists for the document type
      const blueprint = await this.getBlueprintForType(doc.type, options.templateId);
      if (!blueprint) {
        const diag = `[ID: ${id}] [Stage: Blueprint_Lookup] [Lifecycle: ${doc.status}] No layout blueprint found for document type '${doc.type}'. Every document type must have a corresponding blueprint to define its visual structure.`;
        throw new Error(diag);
      }

      const payload = doc.payload;

      // 3. Validate the document payload against required bindings
      const validation = this.validatePayloadBindings(payload, blueprint);
      if (!validation.isValid) {
        const diag = `[ID: ${id}] [Stage: Payload_Validation] [Lifecycle: ${doc.status}] Payload validation failed. The document data is missing required fields defined in the blueprint: ${validation.missing.join(', ')}. Populate these fields in the source record before previewing.`;
        throw new Error(diag);
      }

      // 4. Run the layout engine to generate a paginated render tree if none exists
      let renderModel;
      if (doc.render_model) {
        renderModel = doc.render_model;
      } else {
        console.log(`Generating missing render model for document ${id}...`);
        const boundBlueprint = this.layoutEngine.calculate(payload, blueprint);
        renderModel = this.layoutEngine.generate(boundBlueprint);
      }

      // POLICY UPDATE: previewed DRAFT documents are flagged for watermarking
      if (doc.status === 'draft') {
        renderModel.security = {
          ...renderModel.security,
          watermark: {
            text: 'DRAFT',
            color: 'rgba(255, 0, 0, 0.2)',
            fontSize: 60,
            angle: -45
          }
        };
        console.log(`[DocumentService] Watermarking applied to DRAFT document ${id}.`);
      }

      return renderModel;
    } catch (e) {
      console.error(`[DocumentService] Preview Pipeline Failure for ${id}:`, e.message);
      
      if (e instanceof ResolutionError) {
        throw e; // Rethrow structured error
      }
      
      // If it's a generic error but we have an ID, we wrap it with context if it doesn't already have it
      const diag = e.message.startsWith('[ID:') 
        ? e.message 
        : `[ID: ${id}] [Stage: Preview_Pipeline] [Lifecycle: unknown] Pipeline Failure: ${e.message}`;
      
      const error = new Error(`Preview Pipeline Failure: ${e.message}`);
      error.diagnostic = diag;
      throw error;
    }
  }

  /**
   * Helper to find a blueprint for a given type.
   * Currently looks in contracts/examples but could be moved to a dedicated directory.
   */
  async getBlueprintForType(type, templateId = null) {
    // 1. If a specific template ID is requested, look in the blueprints directory
    if (templateId) {
      const blueprintPath = path.resolve(__dirname, `../../contracts/blueprints/${templateId}.json`);
      if (fs.existsSync(blueprintPath)) {
        return JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
      }
    }

    // 2. Fallback to default layout in examples directory
    const blueprintPath = path.resolve(__dirname, `../../contracts/examples/${type.toLowerCase()}-layout.json`);
    if (fs.existsSync(blueprintPath)) {
      return JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
    }
    return null;
  }

  /**
   * Simple validation of payload against placeholders in the blueprint.
   */
  validatePayloadBindings(payload, blueprint) {
    const missing = [];
    const placeholders = new Set();

    // Collect all placeholders from the blueprint
    const collectPlaceholders = (node) => {
      if (!node) return;
      if (node.type === 'text' && node.content) {
        const matches = node.content.matchAll(/\{\{([\w\.]+)\}\}/g);
        for (const match of matches) {
          placeholders.add(match[1]);
        }
      } else if (node.type === 'container' && node.children) {
        node.children.forEach(collectPlaceholders);
      } else if (node.type === 'table') {
        if (node.dataSource) {
          placeholders.add(node.dataSource);
        }
        // Also check cell templates in table
        if (node.rows && node.rows[0]) {
          Object.values(node.rows[0].cells).forEach(collectPlaceholders);
        }
      }
    };

    blueprint.fixedSections.forEach(s => collectPlaceholders(s.content));
    blueprint.flowSections.forEach(s => s.elements.forEach(collectPlaceholders));

    // Check if payload has these values
    placeholders.forEach(path => {
      // Ignore placeholders that refer to the local 'item' in a table loop
      if (path.startsWith('item.') || path === 'item') return;

      const value = path.split('.').reduce((acc, part) => acc && acc[part], payload);
      if (value === undefined || value === null) {
        missing.push(path);
      }
    });

    return {
      isValid: missing.length === 0,
      missing
    };
  }

  /**
   * Export PDF: Generates a PDF from the document's render model using Puppeteer.
   */
  async exportPdf(id) {
    
    // Resolve the document
    const doc = await this.resolveDocument(id);
    if (!doc) {
      throw new Error('Document not found');
    }

    // Get the render model
    let renderModel = doc.render_model;
    if (!renderModel && doc.payload) {
      // Generate render model if not exists
      const blueprint = await this.getBlueprintForType(doc.type);
      if (blueprint) {
        const boundBlueprint = this.layoutEngine.calculate(doc.payload, blueprint);
        renderModel = this.layoutEngine.generate(boundBlueprint);
      }
    }

    if (!renderModel) {
      throw new Error('Cannot generate PDF: no render model available');
    }

    // Parse render model if it's a string
    if (typeof renderModel === 'string') {
      renderModel = JSON.parse(renderModel);
    }

    // Check if puppeteer is available
    if (!puppeteer) {
      console.warn('[DocumentService] PDF export requested but Puppeteer not installed. Returning render model.');
      return {
        success: false,
        message: 'PDF generation library not configured',
        renderModel: renderModel,
        docType: doc.type,
        docId: doc.id
      };
    }

    // Generate HTML from render model
    const html = this.renderModelToHtml(renderModel);
    
    // Launch browser and generate PDF
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        }
      });
      
      await browser.close();
      
      return {
        success: true,
        pdfBuffer: pdfBuffer,
        docType: doc.type,
        docId: doc.id
      };
    } catch (err) {
      await browser.close();
      throw err;
    }
  }

  /**
   * Convert render model to HTML for PDF generation
   */
  renderModelToHtml(renderModel) {
    // Basic HTML template
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${renderModel.type || 'Document'}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .content { margin: 20px 0; }
          .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f5f5f5; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${renderModel.type || 'Document'}</h1>
        </div>
        <div class="content">
          <pre>${JSON.stringify(renderModel, null, 2)}</pre>
        </div>
        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
        </div>
      </body>
      </html>
    `;
    
    return html;
  }

  /**
   * Log an audit action.
   */
  async logAudit(userId, action, entityType, entityId, details) {
    const query = `
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?)
    `;
    return new Promise((resolve, reject) => {
      const params = [userId, action, entityType, entityId, JSON.stringify(details)];
      getDb().run(query, params, function(err) {
        if (err) {
          console.error('[DocumentService] Audit log insert failed:', err);
          return reject(err);
        }
        resolve(this.lastID);
      });
    });
  }
}

module.exports = new DocumentService();
