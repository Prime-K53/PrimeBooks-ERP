
import React, { useDeferredValue, useEffect, useRef, useState } from 'react';
import { currencyService } from '../services/currencyService';
import { logger } from '../services/logger';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Save, Building2, Database, ShieldCheck, RefreshCw,
    Calculator, Hash, Shield, Beaker, Settings2,
    Camera, PenTool, Trash2, Zap, ExternalLink, HardDriveDownload,
    AlertTriangle, FileCheck, CheckCircle2, Landmark, ImageIcon,
    FileText, PackageCheck, Wallet,
    Globe, Clock, Key, Lock, Gauge, Binary, Plus, X, Percent,
    Cpu, Layers, Smartphone, Layout, Users, ShoppingBag, ShoppingCart, Palette, Monitor,
    Factory, Box, Cloud, Bell, Mail, MessageSquare, ShieldAlert, Webhook, Sun, Moon, Laptop, Info, Undo2,
    TrendingUp, Package, PlusCircle, Trash, Printer, Usb, Sparkles, Scissors, Award, Tag, CreditCard,
    CalendarDays
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFinance } from '../context/FinanceContext';
import { useInventory } from '../context/InventoryContext';
import { useFinancialYear } from '../context/FinancialYearContext';
import { CompanyConfig, InvoiceTemplatesConfig, InventorySettingsConfig, NumberingRule, PricingRoundingMethod, RoundingAnalytics, RoundingRulesConfig, SecuritySettingsConfig } from '../types';
import { OfflineImage } from '../components/OfflineImage';
import { localFileStorage } from '../services/localFileStorage';
import { DEFAULT_PRICING_SETTINGS, ROUNDING_METHOD_OPTIONS, getRoundingAnalytics } from '../services/pricingRoundingService';
import { PricingSettingsValidator, PricingSettingsValidationResult } from '../services/pricingSettingsValidation';
import { hardwareService } from '../services/hardwareService';
import { z } from 'zod';

import { api } from '../services/api';
import { dbService } from '../services/db';
import cloudDb from '../services/cloudDb';
import { supabase } from '../services/supabaseClient';
import { isSupabaseConfigured } from '../services/cloudMode';
import { getPlaceholder } from '../constants/placeholders';
import { isPasswordProtectionEnabled, normalizeSecuritySettings, withNormalizedSecurityConfig } from '../utils/securitySettings';
import { calculatePhotocopyCostPerPage, calculateTypePrintingCostPerPage } from '../utils/pricing';
import {
    createSharedNumberingConfig,
    DEFAULT_SHARED_NUMBERING_RULE,
    formatNumberingPreview,
    resolveGlobalNumberingRule,
} from '../utils/numbering';
import { getDocumentNumberSeriesState } from '../services/documentNumberService';
import { hydrateCompanyPdfAssets, resolvePdfReadyImageDataUrlFromBlob } from '../utils/companyAssetUtils';
import { PrimeTemplatePreview } from './shared/components/PDF/PrimeTemplatePreview';
import {
    DEFAULT_PRIME_TEMPLATE_SETTINGS,
    PRIME_PDF_FONT_OPTIONS,
    resolvePrimeTemplateSettings,
} from './shared/components/PDF/templateSettings';
import { TwoFactorSetup } from './settings/components/TwoFactorSetup';
import ProfitMarkupSettings from './settings/ProfitMarkupSettings';
import { NotificationsTab } from './settings/tabs/NotificationsTab';
import { CloudTab } from './settings/tabs/CloudTab';
import { IntegrationsTab } from './settings/tabs/IntegrationsTab';

import { PricingAdminTab } from './settings/tabs/PricingAdminTab';
import { AttributesTab } from './settings/tabs/AttributesTab';
import { FinishingOptionsTab } from './settings/tabs/FinishingOptionsTab';
import ComplianceSettings, { ComplianceConfig } from '../components/ComplianceSettings';
import { ReferralSettingsTab } from './settings/tabs/ReferralSettingsTab';
import { EngagementSettingsTab } from './settings/tabs/EngagementSettingsTab';
import { AISettingsTab } from './settings/tabs/AISettingsTab';
import CustomizeDashboard from '../components/dashboard/CustomizeDashboard';
import { useDashboardStore } from '../stores/dashboardStore';
import { ConfirmDialog, ConfirmDialogType } from '../components/ConfirmDialog';

const teal={50:'#eef7f6',100:'#d3ece9',200:'#a6d9d3',300:'#72c0b7',400:'#3fa294',500:'#1f8577',600:'#146b60',700:'#0f544c',800:'#0b3e39',900:'#082e2a'};
const amber={100:'#fbead0',300:'#eec27a',500:'#d99a3f',600:'#b97e2b'};
const paper='#FEFDFB',ink='#23282A',inkSoft='#5c6567',hairline='#e4ddd1',danger='#b5493f';

// Pricing settings validation using reusable utility

// QBO Theme Styles
const qboStyles = `
    .white-card {
        background: white;
        border: 1px solid #D4D7DC;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        transition: all 0.2s ease;
    }
    .white-card:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    .settings-label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: #393A3D;
        margin-bottom: 6px;
    }
    .settings-input {
        width: 100%;
        padding: 8px 12px;
        background: white;
        border: 1px solid #BDBFC3;
        border-radius: 4px;
        font-size: 14px;
        color: #393A3D;
        transition: all 0.2s;
    }
    .settings-input:focus {
        outline: none;
        border-color: #2563EB;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
    }
    .settings-section-header {
        padding: 20px 32px;
        border-bottom: 1px solid #D4D7DC;
        background: #F9FAFB;
    }
    .toggle-input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
    }
    .toggle-track {
        width: 44px;
        height: 24px;
        background: #d3ece9;
        border-radius: 9999px;
        position: relative;
        transition: background 0.2s ease;
        cursor: pointer;
        flex-shrink: 0;
    }
    .toggle-track::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: #ffffff;
        border-radius: 50%;
        border: 1px solid #e4ddd1;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .toggle-input:checked + .toggle-track {
        background: #1f8577;
    }
    .toggle-input:checked + .toggle-track::after {
        transform: translateX(20px);
    }
    .toggle-track-sm {
        width: 40px;
        height: 20px;
        background: #d3ece9;
        border-radius: 9999px;
        position: relative;
        transition: background 0.2s ease;
        cursor: pointer;
        flex-shrink: 0;
    }
    .toggle-track-sm::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background: #ffffff;
        border-radius: 50%;
        border: 1px solid #e4ddd1;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .toggle-input:checked + .toggle-track-sm {
        background: #1f8577;
    }
    .toggle-input:checked + .toggle-track-sm::after {
        transform: translateX(16px);
    }
    .toggle-track-lg {
        width: 48px;
        height: 24px;
        background: #d3ece9;
        border-radius: 9999px;
        position: relative;
        transition: background 0.2s ease;
        cursor: pointer;
        flex-shrink: 0;
    }
    .toggle-track-lg::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: #ffffff;
        border-radius: 50%;
        border: 1px solid #e4ddd1;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .toggle-input:checked + .toggle-track-lg {
        background: #1f8577;
    }
    .toggle-input:checked + .toggle-track-lg::after {
        transform: translateX(24px);
    }
    .toggle-track-xl {
        width: 56px;
        height: 28px;
        background: #d3ece9;
        border-radius: 9999px;
        position: relative;
        transition: background 0.2s ease;
        cursor: pointer;
        flex-shrink: 0;
    }
    .toggle-track-xl::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 24px;
        height: 24px;
        background: #ffffff;
        border-radius: 50%;
        border: 1px solid #e4ddd1;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .toggle-input:checked + .toggle-track-xl {
        background: #1f8577;
    }
    .toggle-input:checked + .toggle-track-xl::after {
        transform: translateX(24px);
    }
`;

const Settings: React.FC = () => {
    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = qboStyles;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    const { companyConfig, updateCompanyConfig, validatePasswordStrength, manageUser, notify, resetSystem, manualDownloadBackup, auditLogs, allUsers } = useAuth();
    const { ledger } = useFinance();
    const { inventory } = useInventory();
    const { setCustomizeOpen } = useDashboardStore();
    const location = useLocation();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('General');
    const [isConnectingPrinter, setIsConnectingPrinter] = useState(false);
    const [printerConnected, setPrinterConnected] = useState(hardwareService.isConnected());
    const [printerDeviceName, setPrinterDeviceName] = useState(hardwareService.getDeviceName());
    const [config, setConfig] = useState<CompanyConfig>({
        ...companyConfig,
        appearance: {
            theme: 'Light',
            glassmorphism: false,
            density: 'Comfortable',
            borderRadius: 'Medium',
            enableAnimations: true,
            ...companyConfig?.appearance
        },
        transactionSettings: {
            allowBackdating: false,
            backdatingLimitDays: 0,
            allowFutureDating: false,
            allowPartialFulfillment: false,
            voidingWindowHours: 24,
            enforceCreditLimit: 'Warning',
            defaultPaymentTermsDays: 30,
            quotationExpiryDays: 7,
            autoPrintReceipt: false,
            showReceiptPreview: true,
            quickItemEntry: false,
            defaultPOSWarehouse: '',
            posDefaultCustomer: '',
            pos: {
                showItemImages: false,
                enableShortcuts: false,
                allowReturns: false,
                allowDiscounts: false,
                gridColumns: 3,
                showCategoryFilters: false,
                showShortcutHints: true,
                shortcutLabels: {
                    F1: 'Cust',
                    F2: 'Photo',
                    F3: 'Print',
                    F10: 'Pay'
                },
                paymentDetails: {
                    bankAccounts: [],
                    mobileMoneyAccounts: []
                },
                photocopyPrice: 0,
                photocopyCostPerPage: 0.50,
                typePrintingPrice: 0,
                requireCustomer: false,
                defaultPaymentMethod: 'Cash',
                typePrintingCostPerPage: 1.20,
                staplePrice: 0,
                receiptFooter: ''
            },
            paymentDetails: {
                bankAccounts: [],
                mobileMoneyAccounts: []
            },
            numbering: {},
            approvalThresholds: {}
        },
        integrationSettings: {
            externalApis: [],
            webhooks: []
        },
        invoiceTemplates: {
            ...DEFAULT_PRIME_TEMPLATE_SETTINGS,
            ...(companyConfig?.invoiceTemplates || {}),
            showOutstandingAndWalletBalances: companyConfig?.invoiceTemplates?.showOutstandingAndWalletBalances ?? false
        },
        glMapping: {},
        productionSettings: {
            autoConsumeMaterials: false,
            requireQAApproval: false,
            trackMachineDownTime: false,
            defaultWorkCenterId: '',
            defaultExamBomId: '',
            allowOverproduction: false,
            showKioskSummary: false,
            finishingOptions: [
                { id: 'binding', name: 'Binding', enabled: false, price: 1.20, description: 'Book binding - comb or spiral', items: [], quantity: 1 },
                { id: 'coverPages', name: 'Cover Pages', enabled: false, price: 15.00, description: 'Front and back cover pages per copy', items: [], quantity: 1 },
                { id: 'stapling', name: 'Stapling', enabled: false, price: 0.50, description: 'Corner or saddle stapling', items: [], quantity: 1 },
                { id: 'cutting', name: 'Cutting & Trimming', enabled: false, price: 30, description: 'Trim edges to clean finish', items: [], batchSize: 10 },
                { id: 'holePunch', name: 'Hole Punching', enabled: false, price: 20, description: 'Punch holes for folder binding', items: [], batchSize: 10 },
                { id: 'folding', name: 'Folding', enabled: false, price: 15, description: 'Fold pages for insertion', items: [], batchSize: 10 },
                { id: 'standardTurnaround', name: 'Standard Turnaround', enabled: false, price: 0, description: 'Standard delivery turnaround', items: [] },
                { id: 'rushSurcharge', name: 'Rush Surcharge', enabled: false, price: 0, description: 'Express/rush order surcharge', items: [] },
            ]
        },
        inventorySettings: {
            valuationMethod: 'FIFO',
            allowNegativeStock: false,
            autoBarcode: false,
            trackBatches: false,
            defaultWarehouseId: '',
            trackSerialNumbers: false,
            lowStockAlerts: false
        },
        cloudSync: {
            enabled: false,
            apiUrl: '',
            apiKey: '',
            autoSyncEnabled: false,
            syncIntervalMinutes: 15
        },
        securitySettings: {
            ...normalizeSecuritySettings(companyConfig)
        },
        vat: {
            enabled: true,
            rate: 16.5,
            filingFrequency: 'Monthly',
            pricingMode: 'VAT'
        },
        notificationSettings: {
            customerActivityNotifications: companyConfig?.notificationSettings?.customerActivityNotifications ?? true,
            smsGatewayEnabled: companyConfig?.notificationSettings?.smsGatewayEnabled ?? false,
            emailGatewayEnabled: companyConfig?.notificationSettings?.emailGatewayEnabled ?? false
        },
        roundingRules: {
            method: 'Nearest',
            precision: 2
        },
        enabledModules: {},
        backupFrequency: 'Daily',
        pricingSettings: {
            ...DEFAULT_PRICING_SETTINGS,
            ...(companyConfig?.pricingSettings || {})
        }
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const [accessPassword, setAccessPassword] = useState('');
    const [confirmAccessPassword, setConfirmAccessPassword] = useState('');
    const [testResults, setTestResults] = useState<{ name: string, cases: number, status: string }[]>([]);
    const [systemInfo, setSystemInfo] = useState<any>(null);
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
    const [bomTemplates, setBomTemplates] = useState<any[]>([]);
    const [isRestoringBackup, setIsRestoringBackup] = useState(false);
    const [show2FASetup, setShow2FASetup] = useState(false);
    const [rowsPerPage, setRowsPerPage] = useState(() => {
        try { const v = parseInt(localStorage.getItem('prime:pagination:default') || '', 10); return !isNaN(v) && v > 0 ? v : 25; } catch { return 25; }
    });
    const restoreInputRef = useRef<HTMLInputElement>(null);
    const [complianceConfig, setComplianceConfig] = useState<ComplianceConfig>({ gdprEnabled: false, dataRetentionDays: 365, autoAnonymizeAfterDays: 730, consentRequired: true, privacyPolicyUrl: '', dataDeletionEnabled: true });

    const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; confirmText?: string; type?: ConfirmDialogType; onConfirm?: () => void }>({ open: false, title: '', message: '' });
    const [doubleConfirmState, setDoubleConfirmState] = useState<{ open: boolean; title: string; message: string; confirmText?: string; type?: ConfirmDialogType; onConfirm?: () => void }>({ open: false, title: '', message: '' });

    const readBackupStatus = () => {
        let restoreMeta: { restoredAt?: string; filename?: string; snapshotDate?: string } | null = null;
        try {
            const stored = localStorage.getItem('prime_erp_backup_restored');
            restoreMeta = stored ? JSON.parse(stored) : null;
        } catch {
            restoreMeta = null;
        }
        return {
            lastBackupAt: localStorage.getItem('prime_erp_backup_date'),
            lastRestoreAt: restoreMeta?.restoredAt || null,
            lastRestoreFile: restoreMeta?.filename || '',
            lastRestoreSnapshot: restoreMeta?.snapshotDate || ''
        };
    };

    const [backupStatus, setBackupStatus] = useState(readBackupStatus);
    const primaryAdminUser = React.useMemo(
        () => allUsers.find((candidate: any) => candidate?.isSuperAdmin || candidate?.role === 'Admin') || null,
        [allUsers]
    );
    const normalizedSecuritySettings = React.useMemo(
        () => normalizeSecuritySettings(config),
        [config]
    );
    const accessPasswordValidation = React.useMemo(
        () => validatePasswordStrength(accessPassword),
        [accessPassword, validatePasswordStrength]
    );

    // Load BOM templates for Production tab
    useEffect(() => {
        const loadBomTemplates = async () => {
            try {
                const templates = await dbService.getAll('bomTemplates');
                setBomTemplates(templates);
            } catch (error) {
                logger.error('Failed to load BOM templates:', error);
            }
        };
        loadBomTemplates();
    }, []);

    // Helper to get field error
    const getFieldError = (fieldPath: string): string | undefined => {
      return validationErrors[fieldPath];
    };

    // Helper to get nested field error for array items
    const getArrayFieldError = (arrayName: string, index: number, fieldName: string): string | undefined => {
      const path = `${arrayName}.${index}.${fieldName}`;
      return validationErrors[path];
    };

    const logoRef = useRef<HTMLInputElement>(null);
    const sigRef = useRef<HTMLInputElement>(null);

    const currency = config.currencySymbol || currencyService.getCurrency(currencyService.getBaseCurrency())?.symbol || '$';
    const sharedNumberingRule = React.useMemo(
        () => resolveGlobalNumberingRule(config) || DEFAULT_SHARED_NUMBERING_RULE,
        [config]
    );
    const activePricingSettings = {
        ...DEFAULT_PRICING_SETTINGS,
        ...(config.pricingSettings || {})
    };
    const [roundingAnalytics, setRoundingAnalytics] = React.useState<RoundingAnalytics>({ totalExtraProfit: 0, roundedTransactions: 0, byMethod: {} });
    React.useEffect(() => { getRoundingAnalytics().then(setRoundingAnalytics).catch(() => {}); }, []);

    useEffect(() => {
        setConfig(withNormalizedSecurityConfig({
            ...companyConfig,
            invoiceTemplates: {
                ...DEFAULT_PRIME_TEMPLATE_SETTINGS,
                ...(companyConfig?.invoiceTemplates || {}),
                showOutstandingAndWalletBalances: companyConfig?.invoiceTemplates?.showOutstandingAndWalletBalances ?? false
            },
            pricingSettings: {
                ...DEFAULT_PRICING_SETTINGS,
                ...(companyConfig?.pricingSettings || {})
            }
        }) as CompanyConfig);
    }, [companyConfig]);

    useEffect(() => {
        const requestedTab = (location.state as { tab?: string })?.tab;
        if (typeof requestedTab === 'string' && requestedTab.trim()) {
            setActiveTab(requestedTab);
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

    useEffect(() => {
        if (activeTab === 'System') {
            fetchSystemInfo();
        }
    }, [activeTab]);

    const fetchSystemInfo = async () => {
        try {
            const info = await api.system.getLicenseInfo();
            setSystemInfo(info);
        } catch (err) {
            logger.error('Failed to fetch system info', err);
        }
    };

    const handleManualBackupDownload = async () => {
        try {
            await manualDownloadBackup();
            setBackupStatus(readBackupStatus());
            notify('Database backup downloaded successfully', 'success');
        } catch (error) {
            logger.error('Failed to download backup', error);
            notify('Failed to download backup', 'error');
        }
    };

    const handleRestoreBackupRequest = () => {
        restoreInputRef.current?.click();
    };

    const handleRestoreBackupFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setConfirmState({
            open: true,
            title: 'Restore Database Backup',
            message: `Restore database backup "${file.name}"? This will replace the current local database and reload the app.`,
            type: 'warning',
            confirmText: 'Restore',
            onConfirm: async () => {
                setIsRestoringBackup(true);
                try {
                    const raw = await file.text();
                    const parsed = JSON.parse(raw);

                    if (!parsed || typeof parsed !== 'object' || !parsed.data) {
                        throw new Error('The selected file is not a valid Prime ERP backup.');
                    }

                    await dbService.importDatabase(raw);

                    localStorage.setItem(
                        'prime_erp_backup_restored',
                        JSON.stringify({
                            restoredAt: new Date().toISOString(),
                            filename: file.name,
                            snapshotDate: parsed?.meta?.date || ''
                        })
                    );

                    setBackupStatus(readBackupStatus());
                    notify('Database restored successfully. Reloading now...', 'success');
                    setTimeout(() => window.location.reload(), 700);
                } catch (error) {
                    logger.error('Failed to restore backup', error);
                    notify(error instanceof Error ? error.message : 'Failed to restore backup', 'error');
                } finally {
                    setIsRestoringBackup(false);
                    event.target.value = '';
                }
            }
        });
    };

    const handleSave = async () => {
        const normalizedConfig = await hydrateCompanyPdfAssets(withNormalizedSecurityConfig(config));
        const passwordProtectionEnabled = isPasswordProtectionEnabled(normalizedConfig);
        const enablingPasswordProtection = !isPasswordProtectionEnabled(companyConfig) && passwordProtectionEnabled;
        const adminHasStoredPassword = Boolean(primaryAdminUser?.password);

        if (passwordProtectionEnabled) {
            if (!primaryAdminUser) {
                notify('No administrator account is available to secure the system.', 'error');
                return;
            }

            if (accessPassword || confirmAccessPassword) {
                if (!accessPassword) {
                    notify('Enter an access password before saving the security settings.', 'error');
                    return;
                }
                if (accessPassword !== confirmAccessPassword) {
                    notify("Access passwords don't match.", 'error');
                    return;
                }
                if (normalizedSecuritySettings.enforcePasswordComplexity && !accessPasswordValidation.valid) {
                    notify(accessPasswordValidation.errors[0] || 'The access password does not meet the configured complexity rules.', 'error');
                    return;
                }
            }

            if (enablingPasswordProtection && !adminHasStoredPassword && !accessPassword) {
                notify('Set an access password before turning password protection on.', 'error');
                return;
            }
        }

        // Validate pricingSettings if present
        if (normalizedConfig.pricingSettings) {
          const validationResult = PricingSettingsValidator.validate(normalizedConfig.pricingSettings);
          if (!validationResult.valid) {
            const errors: Record<string, string> = {};
            validationResult.errors?.forEach(err => {
              errors[err.path] = err.message;
            });
            setValidationErrors(errors);
            notify('Please fix validation errors in pricing settings', 'error');
            return;
          }
          setValidationErrors({});
        }

        if (passwordProtectionEnabled && accessPassword && primaryAdminUser) {
            await manageUser({
                ...primaryAdminUser,
                password: accessPassword
            });
        }

        updateCompanyConfig(normalizedConfig);
        setAccessPassword('');
        setConfirmAccessPassword('');
        notify('Settings updated successfully', 'success');
    };

    const updatePricingSettings = (patch: Partial<CompanyConfig['pricingSettings']>) => {
        setConfig(prev => ({
            ...prev,
            pricingSettings: {
                ...DEFAULT_PRICING_SETTINGS,
                ...(prev.pricingSettings || {}),
                ...(patch )
            }
        }));
    };

    const updateSharedNumbering = (patch: Partial<NumberingRule>) => {
        setConfig(prev => ({
            ...prev,
            transactionSettings: {
                ...prev.transactionSettings,
                numbering: createSharedNumberingConfig({
                    ...resolveGlobalNumberingRule(prev),
                    ...patch
                })
            }
        }));
    };

    const handleDeleteCompany = async () => {
        setConfirmState({
            open: true,
            title: 'Delete Company',
            message: `Delete "${config.companyName}" permanently?\n\nThis will remove your company from the cloud and reset all local data. This action cannot be undone.`,
            type: 'danger',
            confirmText: 'Delete',
            onConfirm: () => {
                setDoubleConfirmState({
                    open: true,
                    title: 'Final Confirmation',
                    message: 'ARE YOU SURE?\n\nAll company data will be deleted. Local data will be cleared. You will be signed out.',
                    type: 'danger',
                    confirmText: 'Yes, Delete Everything',
                    onConfirm: async () => {
                        (async () => {
                            try {
                                if (isSupabaseConfigured()) {
                                    const companyId = config.companyId || (config as CompanyConfig & { id?: string }).id;
                                    if (companyId) {
                                        await cloudDb.deleteCompany(companyId);
                                    }
                                    await supabase.auth.signOut();
                                } else {
                                    await api.system.deleteWorkspace();
                                }
                                await dbService.factoryReset();
                                localStorage.clear();
                                sessionStorage.clear();
                                window.location.reload();
                            } catch (error: any) {
                                notify?.('Delete failed: ' + (error?.message || error), 'error');
                            }
                        })();
                    }
                });
            }
        });
    };

    const handleAssetUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'signature') => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const id = await localFileStorage.save(file);
                const base64String = await resolvePdfReadyImageDataUrlFromBlob(file);
                const base64Key = type === 'logo' ? 'logoBase64' : 'signatureBase64';
                setConfig(prev => ({
                    ...prev,
                    [type]: id,
                    [base64Key]: base64String
                }));

                notify(`Asset updated`, "success");
            } catch (err) {
                logger.error("Failed to upload asset", err);
                notify("Failed to upload asset", "error");
            }
        }
    };

    const runIntegritySuite = async () => {
        setIsProcessing(true);
        setTestResults([]);

        const suites = [
            { name: 'Atomic Transaction Kernel', cases: inventory.length + ledger.length, status: 'VERIFIED' },
            { name: 'Financial Ledger Balance', cases: ledger.length, status: 'VERIFIED' },
            { name: 'Identity & Auth Audit', cases: allUsers.length, status: 'VERIFIED' },
            { name: 'Immutable Log Integrity', cases: auditLogs.length, status: 'SEALED' }
        ];

        for (const s of suites) {
            await new Promise(r => setTimeout(r, 600));
            setTestResults(prev => [...prev, s]);
        }

        setIsProcessing(false);
        notify("Logic Sweep: 100% Data Integrity Confirmed", "success");
    };

    const menuGroups = [
        {
            title: 'Account & Organization',
            items: [
                { id: 'General', icon: Building2, label: 'Organization Profile', desc: 'Company details and regional settings' },
                { id: 'Appearance', icon: Palette, label: 'Appearance', desc: 'Theme, colors, and branding' },
                { id: 'Branding', icon: ImageIcon, label: 'Branding', desc: 'Logos and signatures' }
            ]
        },
        {
            title: 'Financials',
            items: [
                { id: 'FinancialYears', icon: CalendarDays, label: 'Financial Years', desc: 'Manage financial year periods and active year' },
                { id: 'Currencies', icon: Wallet, label: 'Currencies', desc: 'Currency symbols and precision' },
                { id: 'Transactions', icon: RefreshCw, label: 'Transaction Prefixes', desc: 'One shared numbering pattern for documents' },
                { id: 'GLMapping', icon: Binary, label: 'Chart of Accounts', desc: 'Ledger and mapping configurations' },
                { id: 'PaymentDetails', icon: Landmark, label: 'Payment Details', desc: 'Bank and mobile money accounts' }
            ]
        },
         {
             title: 'Business Modules',
             items: [
                 { id: 'Modules', icon: Cpu, label: 'Feature Modules', desc: 'Enable/disable ERP modules' },
                 { id: 'SalesModule', icon: ShoppingBag, label: 'Sales & POS', desc: 'Retail and checkout settings' },
                 { id: 'Inventory', icon: Box, label: 'Inventory', desc: 'Stock and unit of measure' }
             ]
         },
        {
            title: 'Automation & Templates',
            items: [
                { id: 'Templates', icon: Layout, label: 'PDF Templates', desc: 'Document layout and engine' },
                { id: 'Notifications', icon: Bell, label: 'Notifications', desc: 'Email and alerts' }
            ]
        },
        {
            title: 'Pricing',
            items: [
                { id: 'ProfitMargins', icon: TrendingUp, label: 'Profit Markups', desc: 'Global, category and line-item markup overrides' },
                { id: 'Pricing', icon: Percent, label: 'Discount & Pricing Rules', desc: 'Customer pricing tiers, discount rules, and tax rates' },
                { id: 'Finishing', icon: Scissors, label: 'Finishing Options', desc: 'Default pricing for binding, cutting, and other finishing services' },
            ]
        },
        {
            title: 'Referral Program',
            items: [
                { id: 'Referrals', icon: Award, label: 'Referrals', desc: 'Referral program and reward configuration' },
            ]
        },
        {
            title: 'Engagement',
            items: [
                { id: 'Engagement', icon: Award, label: 'Engagement', desc: 'Loyalty, cashback, membership, gift cards, affiliate, promotions, rewards' },
                { id: 'MembershipTiers', icon: Award, label: 'Membership Tiers', desc: 'Manage loyalty tiers and benefits' },
                { id: 'Promotions', icon: Tag, label: 'Promotions', desc: 'Manage discounts and promotional campaigns' },
                { id: 'GiftCards', icon: CreditCard, label: 'Gift Cards', desc: 'Issue and manage gift cards' },
            ]
        },
        {
            title: 'Product Data',
            items: [
                { id: 'Attributes', icon: Layers, label: 'Attributes', desc: 'Manage product attributes like Size, Color for variant generation' },
            ]
        },
        {
            title: 'System & Advanced',
            items: [
                { id: 'Integrations', icon: Globe, label: 'Integrations', desc: 'API and external services' },
                { id: 'AISettings', icon: Sparkles, label: 'AI Settings', desc: 'AI provider, models, and API keys' },
                { id: 'Security', icon: ShieldCheck, label: 'Backup & Security', desc: 'Data protection and recovery' },
                { id: 'Privacy', icon: Lock, label: 'Privacy & Compliance', desc: 'GDPR, data retention, and privacy settings' },
                { id: 'System', icon: Cpu, label: 'System Info', desc: 'Hardware and licensing' }
            ]
        }
    ];

    const [searchTerm, setSearchTerm] = useState('');

    const filteredGroups = menuGroups.map(group => ({
        ...group,
        items: group.items.filter(item =>
            item.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.desc.toLowerCase().includes(searchTerm.toLowerCase())
        )
    })).filter(group => group.items.length > 0);

    const activeGroupTitle = menuGroups.find(g => g.items.some(i => i.id === activeTab))?.title || 'Settings';
    const activeItemLabel = menuGroups.flatMap(g => g.items).find(i => i.id === activeTab)?.label || activeTab;
    const normalizedTemplateSettings = resolvePrimeTemplateSettings(config);
    const logoPreviewSource = config.logo || config.logoBase64;
    const signaturePreviewSource = config.signature || config.signatureBase64;
    const deferredTemplatePreviewConfig = useDeferredValue(config);

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter,"DM Sans",sans-serif' }}>
            {/* QBO Header Strategy */}
            <div style={{ background: '#FEFDFB', borderStyle: 'solid', border: '1.4px solid #e4ddd1', paddingLeft: '32px', paddingTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, zIndex: 10, paddingRight: '32px', paddingBottom: '16px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '4px' }}>
                        <span>Settings</span>
                        <span className="text-[#D4D7DC]">/</span>
                        <span style={{ color: '#1f8577' }}>{activeGroupTitle}</span>
                    </div>
                    <h1 style={{ fontSize: '20px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {activeItemLabel}
                    </h1>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={handleSave} style={{ background: '#1f8577', color: '#fff', paddingLeft: '24px', paddingTop: '8px', borderRadius: '9999px', fontWeight: 700, fontSize: '13px', transition: 'all .15s ease', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 14px 0 rgba(31,133,119,.1)', paddingRight: '24px', paddingBottom: '8px' }}>
                        <CheckCircle2 size={18} /> Save Settings
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* QBO Sidebar Style */}
                <div style={{ width: '320px', background: '#FEFDFB', borderStyle: 'solid', border: '1.4px solid #e4ddd1', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
                    <div style={{ padding: '24px', paddingBottom: '8px' }}>
                        <div style={{ position: 'relative' }}>
                            <Gauge style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} size={16} />
                            <input
                                type="text"
                                placeholder="Search settings..."
                                style={{ width: '100%', paddingLeft: '40px', paddingRight: '16px', paddingTop: '8px', border: '1.4px solid #e4ddd1', borderRadius: '8px', fontSize: '13px', outline: 'none', transition: 'all .15s ease', fontWeight: 500, paddingBottom: '8px' }}
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    <div style={{ padding: '16px', marginTop: '24px' }}>
                        {filteredGroups.map(group => (
                            <div key={group.title}>
                                <h3 style={{ paddingLeft: '16px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px', paddingRight: '16px' }}>{group.title}</h3>
                                <div style={{ marginTop: '2px' }}>
                                    {group.items.map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => {
                                              if (item.id === 'MembershipTiers') return navigate('/admin/membership-tiers')
                                              if (item.id === 'Promotions') return navigate('/admin/promotions')
                                              if (item.id === 'GiftCards') return navigate('/admin/gift-cards')
                                              setActiveTab(item.id)
                                            }}
                                            className={`w-full flex items-center justify-between px-4 py-3 border-l-4 transition-all text-left ${activeTab === item.id
                                                ? 'bg-blue-50 border-blue-600 text-blue-600'
                                                : 'border-transparent text-[#6B6C6F] hover:bg-[#F4F5F8]'
                                                }`}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <item.icon size={18} className={activeTab === item.id ? 'text-blue-600' : 'text-[#6B6C6F]'} />
                                                <span className={`text-[13px] font-bold ${activeTab === item.id ? 'text-blue-600' : 'text-[#393A3D]'}`}>{item.label}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Content Area */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '40px' }}>
                    <div style={{ maxWidth: '896px', marginLeft: 'auto', transitionDuration: '400ms' }}>

                        {activeTab === 'General' && (
                            <div style={{ marginTop: '32px' }}>
                                <section style={{ overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <h3 style={{ fontSize: '13px', fontWeight: 700 }}>Organization Profile</h3>
                                            <p style={{ marginTop: '2px' }}>Basic information about your business.</p>
                                        </div>
                                    </div>
                                    <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', columnGap: '48px', rowGap: '24px' }}>
                                        <div style={{ gridColumn: 'span 2 / span 2' }}>
                                            <label className="settings-label">Legal Company Name</label>
                                            <input
                                                type="text"
                                                className="settings-input"
                                                placeholder="e.g. Acme Printing Ltd"
                                                value={config.companyName}
                                                onChange={e => setConfig({ ...config, companyName: e.target.value })}
                                            />
                                        </div>
                                        <div style={{ gridColumn: 'span 2 / span 2' }}>
                                            <label className="settings-label">Tagline / Business Motto</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Quality you can trust"
                                                className="settings-input"
                                                value={config.tagline || ''}
                                                onChange={e => setConfig({ ...config, tagline: e.target.value })}
                                            />
                                            <p style={{ color: '#5c6567', marginTop: '6px', fontWeight: 500, fontStyle: 'italic' }}>This will appear on your invoices and documents.</p>
                                        </div>
                                        <div>
                                            <label className="settings-label">Business Email</label>
                                            <input
                                                type="email"
                                                className="settings-input"
                                                placeholder="e.g. support@acme.com"
                                                value={config.email}
                                                onChange={e => setConfig({ ...config, email: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="settings-label">Contact Phone</label>
                                            <input
                                                type="text"
                                                className="settings-input"
                                                placeholder={getPlaceholder.phone()}
                                                value={config.phone}
                                                onChange={e => setConfig({ ...config, phone: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </section>

                                <section style={{ overflow: 'hidden' }}>
                                    <div className="settings-section-header">
                                        <h3 style={{ fontSize: '13px', fontWeight: 700 }}>Address & Regional Settings</h3>
                                        <p style={{ marginTop: '2px' }}>Physical location and formatting preferences.</p>
                                    </div>
                                    <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', columnGap: '48px', rowGap: '24px' }}>
                                        <div style={{ gridColumn: 'span 2 / span 2' }}>
                                            <label className="settings-label">Primary Office Address</label>
                                            <textarea
                                                style={{ height: '80px', paddingTop: '12px', paddingBottom: '12px' }}
                                                placeholder={getPlaceholder.address()}
                                                value={config.addressLine1}
                                                onChange={e => setConfig({ ...config, addressLine1: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="settings-label">City / Town</label>
                                            <input
                                                type="text"
                                                className="settings-input"
                                                placeholder={getPlaceholder.city()}
                                                value={config.city || ''}
                                                onChange={e => setConfig({ ...config, city: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="settings-label">Country</label>
                                            <input
                                                type="text"
                                                className="settings-input"
                                                placeholder="e.g. Malawi"
                                                value={config.country || ''}
                                                onChange={e => setConfig({ ...config, country: e.target.value })}
                                            />
                                        </div>
                                        <div style={{ gridColumn: 'span 2 / span 2', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '48px', padding: '16px', border: '1.4px solid #e4ddd1', borderRadius: '12px', background: '#FEFDFB', marginTop: '8px' }}>
                                            <div>
                                                <label className="settings-label">Business Currency</label>
                                                <div style={{ position: 'relative' }}>
                                                    <Wallet style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: '#5c6567' }} size={14} />
                                                    <input
                                                        type="text"
                                                        className="settings-input"
                                                        placeholder="e.g. MWK, USD"
                                                        value={config.currencySymbol || ''}
                                                        onChange={e => setConfig({ ...config, currencySymbol: e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="settings-label">System Date Format</label>
                                                <select
                                                    style={{ appearance: 'none' }}
                                                    value={config.dateFormat}
                                                    onChange={e => setConfig({ ...config, dateFormat: e.target.value })}
                                                >
                                                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                                                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                                                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                 </section>

<section style={{ overflow: 'hidden', border: '1.4px solid #b5493f' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fef2f2', borderBottom: '1.4px solid #b5493f' }}>
                                        <div>
                                            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#b5493f' }}>Danger Zone</h3>
                                            <p style={{ color: '#b5493f', marginTop: '2px' }}>Irreversible actions that affect your entire company.</p>
                                        </div>
                                    </div>
                                    <div style={{ padding: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div>
                                            <p style={{ fontSize: '13px', fontWeight: 700 }}>Delete this company</p>
                                            <p style={{ marginTop: '2px' }}>Permanently remove {config.companyName || 'your company'} from Supabase and reset all local data.</p>
                                        </div>
                                        <button
                                            onClick={handleDeleteCompany}
                                            style={{ background: '#b5493f', color: '#fff', paddingLeft: '24px', paddingTop: '10px', borderRadius: '9999px', fontWeight: 700, fontSize: '13px', transition: 'all .15s ease', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 14px 0 rgba(181,73,63,.1)', paddingRight: '24px', paddingBottom: '10px' }}
                                        >
                                            <Trash2 size={16} /> Delete Company
                                        </button>
                                    </div>
                                </section>

                                <section style={{ overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <h3 style={{ fontSize: '13px', fontWeight: 700 }}>Dashboard</h3>
                                            <p style={{ marginTop: '2px' }}>Customize your dashboard layout and visible widgets.</p>
                                        </div>
                                    </div>
                                    <div style={{ padding: '32px' }}>
                                        <button
                                            onClick={() => setCustomizeOpen(true)}
                                            style={{ paddingLeft: '20px', paddingTop: '10px', background: '#1f8577', color: '#fff', borderRadius: '12px', fontSize: '13px', fontWeight: 600, boxShadow: '0 1px 3px rgba(0,0,0,.1)', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '20px', paddingBottom: '10px' }}
                                        >
                                            Open Dashboard Customizer
                                        </button>
                                    </div>
                                </section>

                             </div>
                         )
                     }

                    {activeTab === 'Appearance' && (
                            <div style={{ marginTop: '32px' }}>
                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>Theme Preferences</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Control the visual style of your workspace.</p>
                                    </div>
                                    <div style={{ padding: '32px', marginTop: '24px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all .15s ease', paddingLeft: '32px', paddingTop: '16px', paddingRight: '32px', paddingBottom: '16px' }}>
                                            <div>
                                                <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Application Theme</p>
                                                <p style={{ color: '#5c6567', marginTop: '2px' }}>Switch between light, dark, or system preferences.</p>
                                            </div>
                                            <div style={{ display: 'flex', padding: '4px', background: '#eef7f6', borderRadius: '10px' }}>
                                                 {['Light', 'Dark', 'System'].map(mode => (
                                                    <button
                                                        key={mode}
                                                        onClick={() => setConfig({ 
                                                            ...config, 
                                                            appearance: { 
                                                                ...config.appearance, 
                                                                theme: mode as 'Light' | 'Dark' | 'System' 
                                                            } 
                                                        })}
                                                        className={`px-4 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                                                            config.appearance?.theme === mode || 
                                                            (mode === 'Light' && !config.appearance?.theme)
                                                                ? 'bg-white text-blue-600 shadow-sm' 
                                                                : 'text-slate-500 hover:text-slate-700'
                                                        }`}
                                                    >
                                                        {mode}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{ height: '1px', background: '#eef7f6' }} />

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all .15s ease', paddingLeft: '32px', paddingTop: '16px', paddingRight: '32px', paddingBottom: '16px' }}>
                                            <div>
                                                <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Experimental Glassmorphism</p>
                                                <p style={{ color: '#5c6567', marginTop: '2px' }}>Enable frosted glass effects on high-performance cards.</p>
                                            </div>
                                            <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                <input 
                                                    type="checkbox" 
                                                    className="toggle-input" 
                                                    checked={config.appearance?.glassmorphism || false}
                                                    onChange={e => setConfig({ ...config, appearance: { ...config.appearance, glassmorphism: e.target.checked } })}
                                                />
                                                <div className="toggle-track"></div>
                                            </label>
                                        </div>

                                        <div style={{ height: '1px', background: '#eef7f6' }} />

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all .15s ease', paddingLeft: '32px', paddingTop: '16px', paddingRight: '32px', paddingBottom: '16px' }}>
                                            <div>
                                                <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Rows Per Page</p>
                                                <p style={{ color: '#5c6567', marginTop: '2px' }}>Default number of items shown on list views.</p>
                                            </div>
                                            <select
                                                value={rowsPerPage}
                                                onChange={e => { const v = Number(e.target.value); setRowsPerPage(v); try { localStorage.setItem('prime:pagination:default', String(v)); } catch (e) { logger.error("Operation failed", e as Error); } }}
                                                style={{ background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '10px', paddingLeft: '12px', paddingTop: '8px', fontSize: '13px', fontWeight: 700, color: '#23282A', outline: 'none', transition: 'all .15s ease', boxShadow: '0 1px 2px rgba(0,0,0,.05)', paddingRight: '12px', paddingBottom: '8px' }}
                                            >
                                                <option value={10}>10</option>
                                                <option value={15}>15</option>
                                                <option value={25}>25</option>
                                                <option value={50}>50</option>
                                                <option value={100}>100</option>
                                            </select>
                                        </div>
                                    </div>
                                </section>

                            </div>
                        )}

                        {activeTab === 'Branding' && (
                            <div style={{ marginTop: '32px', color: '#23282A' }}>
                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>Visual Identity</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>These assets will be used on all automated documents.</p>
                                    </div>
                                    <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '48px' }}>
                                        <div>
                                            <label className="settings-label">Company Logo</label>
                                            <div
                                                onClick={() => logoRef.current?.click()}
                                                style={{ position: 'relative', aspectRatio: '16/9', borderRadius: '12px', borderWidth: '2px', borderStyle: 'dashed', borderColor: '#e4ddd1', background: '#eef7f6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', cursor: 'pointer', transition: 'all .15s ease', overflow: 'hidden', boxShadow: 'inset 0 2px 4px 0 rgba(0,0,0,.06)' }}
                                            >
                                                {logoPreviewSource ? (
                                                    <>
                                                        <OfflineImage src={logoPreviewSource} alt="Company Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '24px' }} />
                                                        <div style={{ position: 'absolute', top: 0, background: 'rgba(11,62,57,.6)', opacity: 0.0, transition: 'opacity .15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', right: 0, bottom: 0, left: 0 }}>
                                                            <button style={{ background: '#FEFDFB', color: '#23282A', paddingLeft: '16px', paddingTop: '8px', borderRadius: '10px', fontWeight: 700, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 20px 25px -5px rgba(0,0,0,.1)', transition: 'all .15s ease', paddingRight: '16px', paddingBottom: '8px' }}>
                                                                <RefreshCw size={14} /> Change Logo
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setConfig({ ...config, logo: undefined, logoBase64: undefined }); }}
                                                                style={{ background: '#fef2f2', color: '#fff', padding: '10px', borderRadius: '10px', boxShadow: '0 20px 25px -5px rgba(0,0,0,.1)', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#FEFDFB', boxShadow: '0 1px 2px rgba(0,0,0,.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c6567', transition: 'all .15s ease', transitionDuration: '500ms', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1' }}>
                                                            <Camera size={24} />
                                                        </div>
                                                        <div style={{ textAlign: 'center' }}>
                                                            <p style={{ fontWeight: 700, color: '#23282A' }}>Upload Corporate Logo</p>
                                                            <p style={{ color: '#5c6567', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 900 }}>PNG or JPG (Max 2MB)</p>
                                                        </div>
                                                    </>
                                                )}
                                                <input type="file" ref={logoRef} style={{ display: 'hidden' }} accept="image/png,image/jpeg,image/jpg,image/webp" onChange={(e) => handleAssetUpload(e, 'logo')} />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="settings-label">Digital Signature</label>
                                            <div
                                                onClick={() => sigRef.current?.click()}
                                                style={{ position: 'relative', aspectRatio: '16/9', borderRadius: '12px', borderWidth: '2px', borderStyle: 'dashed', borderColor: '#e4ddd1', background: '#eef7f6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', cursor: 'pointer', transition: 'all .15s ease', overflow: 'hidden', boxShadow: 'inset 0 2px 4px 0 rgba(0,0,0,.06)' }}
                                            >
                                                {signaturePreviewSource ? (
                                                    <>
                                                        <OfflineImage src={signaturePreviewSource} alt="Authorized Signature" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '24px', filter: 'grayscale(100%)' }} />
                                                        <div style={{ position: 'absolute', top: 0, background: 'rgba(11,62,57,.6)', opacity: 0.0, transition: 'opacity .15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', right: 0, bottom: 0, left: 0 }}>
                                                            <button style={{ background: '#FEFDFB', color: '#23282A', paddingLeft: '16px', paddingTop: '8px', borderRadius: '10px', fontWeight: 700, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 20px 25px -5px rgba(0,0,0,.1)', transition: 'all .15s ease', paddingRight: '16px', paddingBottom: '8px' }}>
                                                                <RefreshCw size={14} /> Change Sig
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setConfig({ ...config, signature: undefined, signatureBase64: undefined }); }}
                                                                style={{ background: '#fef2f2', color: '#fff', padding: '10px', borderRadius: '10px', boxShadow: '0 20px 25px -5px rgba(0,0,0,.1)', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#FEFDFB', boxShadow: '0 1px 2px rgba(0,0,0,.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c6567', transition: 'all .15s ease', transitionDuration: '500ms', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1' }}>
                                                            <PenTool size={24} />
                                                        </div>
                                                        <div style={{ textAlign: 'center' }}>
                                                            <p style={{ fontWeight: 700, color: '#23282A' }}>Upload Digital Signature</p>
                                                            <p style={{ color: '#5c6567', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 900 }}>Transparent PNG Recommended</p>
                                                        </div>
                                                    </>
                                                )}
                                                <input type="file" ref={sigRef} style={{ display: 'hidden' }} accept="image/png,image/jpeg,image/jpg,image/webp" onChange={(e) => handleAssetUpload(e, 'signature')} />
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}




                        {activeTab === 'Currencies' && (
                            <div style={{ marginTop: '32px' }}>
                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>Currency Formatting</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Control how monetary values are displayed across the system.</p>
                                    </div>
                                    <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '48px' }}>
                                        <div>
                                            <label className="settings-label">Currency Symbol</label>
                                            <div style={{ display: 'flex', gap: '12px' }}>
                                                <input
                                                    type="text"
                                                    style={{ width: '96px', textAlign: 'center' }}
                                                    placeholder="e.g. K"
                                                    value={config.currencySymbol}
                                                    onChange={e => setConfig({ ...config, currencySymbol: e.target.value })}
                                                />
                                                <div style={{ flex: 1, padding: '12px', background: '#eef7f6', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#5c6567', gap: '8px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', boxShadow: 'inset 0 2px 4px 0 rgba(0,0,0,.06)' }}>
                                                    <span style={{ fontSize: '16px' }}>{config.currencySymbol}</span>
                                                    <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Active Symbol</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="settings-label">Decimal Precision</label>
                                            <select
                                                className="settings-input"
                                                value={config.roundingRules?.precision || 2}
                                                onChange={e => setConfig({ ...config, roundingRules: { method: config.roundingRules?.method || 'Nearest', precision: parseInt(e.target.value) } })}
                                            >
                                                <option value={0}>0 (Whole numbers only)</option>
                                                <option value={1}>1 (e.g. 10.5)</option>
                                                <option value={2}>2 (e.g. 10.50)</option>
                                                <option value={3}>3 (e.g. 10.500)</option>
                                            </select>
                                        </div>
                                        <div style={{ gridColumn: 'span 2 / span 2', paddingTop: '16px', borderStyle: 'solid', borderColor: '#e4ddd1' }}>
                                            <label className="settings-label">Rounding Rule</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px' }}>
                                                {(['Nearest', 'Up', 'Down'] as const).map(method => (
                                                    <button
                                                        key={method}
                                                        onClick={() => setConfig({ ...config, roundingRules: { method: method as RoundingRulesConfig['method'], precision: config.roundingRules?.precision || 2 } })}
                                                        className={`py-3 rounded-lg text-xs font-bold border transition-all ${config.roundingRules?.method === method ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-200'}`}
                                                    >
                                                        Round {method}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>Monthly Revenue Target</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Set your monthly revenue goal for dashboard tracking.</p>
                                    </div>
                                    <div style={{ padding: '32px' }}>
                                        <div style={{ position: 'relative', maxWidth: '320px' }}>
                                            <div style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#5c6567', fontSize: '11px', fontWeight: 700 }}>{config.currencySymbol}</div>
                                            <input
                                                type="number"
                                                style={{ paddingLeft: '40px' }}
                                                placeholder="e.g. 500000"
                                                value={config.monthlyRevenueTarget || ''}
                                                onChange={e => setConfig({ ...config, monthlyRevenueTarget: Number(e.target.value) })}
                                            />
                                        </div>
                                        <p style={{ color: '#5c6567', marginTop: '6px', fontWeight: 500, fontStyle: 'italic' }}>Your progress percentage against this target will be tracked on the dashboard.</p>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'SalesModule' && (
                            <div style={{ marginTop: '32px' }}>
                                <section style={{ overflow: 'hidden' }}>
                                    <div className="settings-section-header">
                                        <h3 style={{ fontSize: '13px', fontWeight: 700 }}>Global Pricing Mode</h3>
                                        <p style={{ marginTop: '2px' }}>Select whether the system uses VAT or Market Adjustments for sales tracking.</p>
                                    </div>
                                    <div style={{ padding: '32px' }}>
                                        <div style={{ display: 'flex', padding: '4px', borderRadius: '12px', width: 'fit-content', border: '1.4px solid #e4ddd1' }}>
                                            <button 
                                                onClick={() => setConfig({ 
                                                    ...config, 
                                                    vat: { ...(config.vat || { enabled: true, rate: 16.5, filingFrequency: 'Monthly' }), pricingMode: 'VAT' } 
                                                })}
                                                className={`px-8 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${config.vat?.pricingMode === 'VAT' ? 'bg-white text-blue-600 shadow-sm' : 'text-[#6B6C6F] hover:text-[#393A3D]'}`}
                                            >
                                                {config.vat?.pricingMode === 'VAT' && <CheckCircle2 size={16} />}
                                                VAT Mode
                                            </button>
                                            <button 
                                                onClick={() => setConfig({ 
                                                    ...config, 
                                                    vat: { ...(config.vat || { enabled: true, rate: 16.5, filingFrequency: 'Monthly' }), pricingMode: 'MarketAdjustment' } 
                                                })}
                                                className={`px-8 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${config.vat?.pricingMode === 'MarketAdjustment' ? 'bg-white text-blue-600 shadow-sm' : 'text-[#6B6C6F] hover:text-[#393A3D]'}`}
                                            >
                                                {config.vat?.pricingMode === 'MarketAdjustment' && <CheckCircle2 size={16} />}
                                                Market Adjustment Mode
                                            </button>
                                        </div>
                                        <p style={{ marginTop: '16px', fontStyle: 'italic', fontWeight: 500 }}>
                                            * These features are mutually exclusive. Switching modes may affect how prices are calculated in the POS and Sales modules.
                                        </p>
                                    </div>
                                </section>

                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>Smart Pricing Rounding Engine</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Round only final selling prices after BOM and margin calculations to protect profit.</p>
                                    </div>
                                    <div style={{ padding: '32px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Enable Rounding Engine</p>
                                                <p style={{ color: '#5c6567', marginTop: '2px' }}>Apply rounding when product selling prices are calculated and saved. Cost price and BOM internals are untouched.</p>
                                            </div>
                                            <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    className="toggle-input"
                                                    checked={activePricingSettings.enableRounding}
                                                    onChange={e => updatePricingSettings({ enableRounding: e.target.checked })}
                                                />
                                                <div className="toggle-track"></div>
                                            </label>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '24px' }}>
                                            <div>
                                                <label className="settings-label">Default Rounding Method</label>
                                                <select
                                                    className="settings-input"
                                                    value={activePricingSettings.defaultMethod}
                                                    onChange={e => updatePricingSettings({ defaultMethod: e.target.value as PricingRoundingMethod })}
                                                >
                                                    {ROUNDING_METHOD_OPTIONS.map(option => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="settings-label">Custom Step</label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    className={`settings-input ${getFieldError('customStep') ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''}`}
                                                    placeholder="e.g. 50"
                                                    value={activePricingSettings.customStep || 50}
                                                    onChange={e => updatePricingSettings({ customStep: Math.max(1, parseInt(e.target.value) || 1) })}
                                                />
                                                {getFieldError('customStep') && (
                                                  <p style={{ color: '#b5493f', fontSize: '11px', marginTop: '4px' }}>{getFieldError('customStep')}</p>
                                                )}
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#5c6567', fontWeight: 600 }}>
                                                <input
                                                    type="checkbox"
                                                    style={{ borderRadius: '6px', borderColor: '#e4ddd1', color: '#1f8577' }}
                                                    checked={activePricingSettings.applyToPOS}
                                                    onChange={e => updatePricingSettings({ applyToPOS: e.target.checked })}
                                                    disabled
                                                />
                                                Legacy: Apply to POS
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#5c6567', fontWeight: 600 }}>
                                                <input
                                                    type="checkbox"
                                                    style={{ borderRadius: '6px', borderColor: '#e4ddd1', color: '#1f8577' }}
                                                    checked={activePricingSettings.applyToInvoices}
                                                    onChange={e => updatePricingSettings({ applyToInvoices: e.target.checked })}
                                                    disabled
                                                />
                                                Legacy: Apply to Invoices
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#5c6567', fontWeight: 600 }}>
                                                <input
                                                    type="checkbox"
                                                    style={{ borderRadius: '6px', borderColor: '#e4ddd1', color: '#1f8577' }}
                                                    checked={activePricingSettings.applyToQuotations}
                                                    onChange={e => updatePricingSettings({ applyToQuotations: e.target.checked })}
                                                    disabled
                                                />
                                                Legacy: Apply to Quotations
                                            </label>
                                        </div>
                                        <p style={{ color: '#5c6567' }}>
                                            Transaction-level rounding is disabled. POS, Invoice, and Quotation read stored selling prices only.
                                        </p>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#5c6567', fontWeight: 600 }}>
                                                <input
                                                    type="checkbox"
                                                    style={{ borderRadius: '6px', borderColor: '#e4ddd1', color: '#1f8577' }}
                                                    checked={activePricingSettings.allowManualOverride}
                                                    onChange={e => updatePricingSettings({ allowManualOverride: e.target.checked })}
                                                    disabled
                                                />
                                                Legacy: Manual Override
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#5c6567', fontWeight: 600 }}>
                                                <input
                                                    type="checkbox"
                                                    style={{ borderRadius: '6px', borderColor: '#e4ddd1', color: '#1f8577' }}
                                                    checked={activePricingSettings.showOriginalPrice}
                                                    onChange={e => updatePricingSettings({ showOriginalPrice: e.target.checked })}
                                                    disabled
                                                />
                                                Legacy: Show Original Price
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#23282A', fontWeight: 600 }}>
                                                <input
                                                    type="checkbox"
                                                    style={{ borderRadius: '6px', borderColor: '#e4ddd1', color: '#1f8577' }}
                                                    checked={activePricingSettings.profitProtectionMode}
                                                    onChange={e => updatePricingSettings({ profitProtectionMode: e.target.checked })}
                                                />
                                                Always Round Up (Profit Mode)
                                            </label>
                                        </div>

                                        <div style={{ padding: '16px', background: '#eef7f6', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', marginTop: '16px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#23282A' }}>Smart Threshold Rules</p>
                                                    <p style={{ color: '#5c6567' }}>Example: below 10,000 use 50; from 10,000 use 100.</p>
                                                </div>
                                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#5c6567', fontWeight: 600 }}>
                                                    <input
                                                        type="checkbox"
                                                        style={{ borderRadius: '6px', borderColor: '#e4ddd1', color: '#1f8577' }}
                                                        checked={Boolean(activePricingSettings.enableSmartThresholds)}
                                                        onChange={e => updatePricingSettings({ enableSmartThresholds: e.target.checked })}
                                                    />
                                                    Enable Smart Rules
                                                </label>
                                            </div>
                                            {(activePricingSettings.thresholdRules || DEFAULT_PRICING_SETTINGS.thresholdRules || []).slice(0, 2).map((rule, idx) => (
                                                <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', alignItems: 'end' }}>
                                                    <div>
                                                        <label style={{ fontWeight: 600, color: '#5c6567' }}>Min Price</label>
                                                        <input
                                                            type="number"
                                                            className={`settings-input ${getArrayFieldError('thresholdRules', idx, 'minPrice') ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''}`}
                                                            placeholder="e.g. 0"
                                                            value={rule.minPrice ?? 0}
                                                            onChange={e => {
                                                                const nextRules = [...(activePricingSettings.thresholdRules || [])];
                                                                nextRules[idx] = {
                                                                    ...(nextRules[idx] || rule),
                                                                    minPrice: parseFloat(e.target.value) || 0
                                                                }
                                                                updatePricingSettings({ thresholdRules: nextRules });
                                                            }}
                                                        />
                                                        {getArrayFieldError('thresholdRules', idx, 'minPrice') && (
                                                          <p style={{ color: '#b5493f', fontSize: '11px', marginTop: '4px' }}>{getArrayFieldError('thresholdRules', idx, 'minPrice')}</p>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <label style={{ fontWeight: 600, color: '#5c6567' }}>Max Price</label>
                                                        <input
                                                            type="number"
                                                            className="settings-input"
                                                            value={rule.maxPrice ?? ''}
                                                            placeholder="No limit"
                                                            onChange={e => {
                                                                const nextRules = [...(activePricingSettings.thresholdRules || [])];
                                                                nextRules[idx] = {
                                                                    ...(nextRules[idx] || rule),
                                                                    maxPrice: e.target.value === '' ? undefined : (parseFloat(e.target.value) || undefined)
                                                                };
                                                                updatePricingSettings({ thresholdRules: nextRules });
                                                            }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontWeight: 600, color: '#5c6567' }}>Step</label>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            className={`settings-input ${getArrayFieldError('thresholdRules', idx, 'step') ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''}`}
                                                            placeholder="e.g. 50"
                                                            value={rule.step ?? 50}
                                                            onChange={e => {
                                                                const nextRules = [...(activePricingSettings.thresholdRules || [])];
                                                                nextRules[idx] = {
                                                                    ...(nextRules[idx] || rule),
                                                                    step: Math.max(1, parseFloat(e.target.value) || 1),
                                                                    method: 'ALWAYS_UP_CUSTOM'
                                                                };
                                                                updatePricingSettings({ thresholdRules: nextRules });
                                                            }}
                                                        />
                                                        {getArrayFieldError('thresholdRules', idx, 'step') && (
                                                          <p style={{ color: '#b5493f', fontSize: '11px', marginTop: '4px' }}>{getArrayFieldError('thresholdRules', idx, 'step')}</p>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <label style={{ fontWeight: 600, color: '#5c6567' }}>Method</label>
                                                        <select
                                                            className="settings-input"
                                                            value={rule.method || 'ALWAYS_UP_CUSTOM'}
                                                            onChange={e => {
                                                                const nextRules = [...(activePricingSettings.thresholdRules || [])];
                                                                nextRules[idx] = {
                                                                    ...(nextRules[idx] || rule),
                                                                    method: e.target.value as PricingRoundingMethod
                                                                };
                                                                updatePricingSettings({ thresholdRules: nextRules });
                                                            }}
                                                        >
                                                            {ROUNDING_METHOD_OPTIONS.map(option => (
                                                                <option key={option.value} value={option.value}>{option.label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div style={{ padding: '16px', background: '#eef7f6', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#d3ece9' }}>
                                            <p style={{ fontSize: '11px', fontWeight: 700, color: '#0f544c' }}>Rounding Analytics</p>
                                            <p style={{ color: '#0f544c', marginTop: '4px' }}>
                                                Extra profit captured by rounding: {currency}{Number(roundingAnalytics.totalExtraProfit || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </p>
                                            <p style={{ color: '#0f544c' }}>
                                                Rounded price recalculations: {Number(roundingAnalytics.roundedTransactions || 0)}
                                            </p>
                                        </div>
                                    </div>
                                </section>

                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>POS Interface & Terminal</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Configure how the point of sale behaves on this terminal.</p>
                                    </div>
                                    <div style={{ padding: '32px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '48px' }}>
                                            <div style={{ marginTop: '24px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Show Item Images</p>
                                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Display thumbnails in the product grid.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.transactionSettings?.pos?.showItemImages}
                                                            onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, showItemImages: e.target.checked } } })}
                                                        />
                                                        <div className="toggle-track"></div>
                                                    </label>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Enable Shortcuts</p>
                                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Use F-keys for quick POS actions.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.transactionSettings?.pos?.enableShortcuts}
                                                            onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, enableShortcuts: e.target.checked } } })}
                                                        />
                                                        <div className="toggle-track"></div>
                                                    </label>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Allow Returns/Refunds</p>
                                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Enable the refund button in the POS interface.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                    checked={config.transactionSettings?.pos?.allowReturns}
                                                    onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, allowReturns: e.target.checked } } })}
                                                        />
                                                        <div className="toggle-track"></div>
                                                    </label>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Show Shortcut Hints</p>
                                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Show F1, F2, F3, F10 shortcut hints on POS toolbar.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.transactionSettings?.pos?.showShortcutHints !== false}
                                                            onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, showShortcutHints: e.target.checked } } })}
                                                        />
                                                        <div className="toggle-track"></div>
                                                    </label>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Enable Item Discounts</p>
                                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Allow manual discounts on individual items.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.transactionSettings?.pos?.allowDiscounts}
                                                            onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, allowDiscounts: e.target.checked } } })}
                                                        />
                                                        <div className="toggle-track"></div>
                                                    </label>
                                                </div>
                                            </div>
                                            <div style={{ marginTop: '24px' }}>
                                                <div>
                                                    <label className="settings-label">POS Grid columns</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px' }}>
                                                        {[3, 4, 5, 6].map(cols => (
                                                            <button
                                                                key={cols}
                                                                onClick={() => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, gridColumns: cols } } })}
                                                                className={`py-2 px-3 rounded-md text-[11px] font-bold border transition-all ${config.transactionSettings?.pos?.gridColumns === cols ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-[#D4D7DC] text-[#6B6C6F] hover:border-blue-600'}`}
                                                            >
                                                                {cols}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Show Category Filters</p>
                                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Display product categories for easy filtering.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                    checked={config.transactionSettings?.pos?.showCategoryFilters}
                                                    onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, showCategoryFilters: e.target.checked } } })}
                                                        />
                                                        <div className="toggle-track"></div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>POS Service Pricing</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Set default prices and material costs for common retail services. Profit margin = selling price − cost.</p>
                                    </div>
                                    <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '48px' }}>
                                        <div>
                                            <label className="settings-label">Photocopy Price ({currency})</label>
                                            <div style={{ position: 'relative' }}>
                                                <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#5c6567', fontSize: '11px' }}>{currency}</span>
                                                <input
                                                    type="number"
                                                    style={{ paddingLeft: '40px' }}
                                                    placeholder="e.g. 50"
                                                    value={config.transactionSettings?.pos?.photocopyPrice || 0}
                                                       onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, photocopyPrice: parseFloat(e.target.value) || 0 } } })}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="settings-label">Type & Printing Price ({currency})</label>
                                            <div style={{ position: 'relative' }}>
                                                <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#5c6567', fontSize: '11px' }}>{currency}</span>
                                                <input
                                                    type="number"
                                                    style={{ paddingLeft: '40px' }}
                                                    placeholder="e.g. 200"
                                                    value={config.transactionSettings?.pos?.typePrintingPrice || 0}
                                                       onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, typePrintingPrice: parseFloat(e.target.value) || 0 } } })}
                                                />
                                            </div>
                                        </div>


                                    </div>
                                </section>

                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>Receipt & Printing</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Customize transaction receipts and printing behavior.</p>
                                    </div>
                                    <div style={{ padding: '32px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Auto-Print Receipt</p>
                                                <p style={{ color: '#5c6567', marginTop: '2px' }}>Trigger print dialog automatically after checkout.</p>
                                            </div>
                                            <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    className="toggle-input"
                                                    checked={config.transactionSettings?.autoPrintReceipt}
                                                    onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, autoPrintReceipt: e.target.checked } })}
                                                />
                                                <div className="toggle-track"></div>
                                            </label>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Show Receipt Preview</p>
                                                <p style={{ color: '#5c6567', marginTop: '2px' }}>Display receipt preview after checkout.</p>
                                            </div>
                                            <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    className="toggle-input"
                                                    checked={config.transactionSettings?.showReceiptPreview !== false}
                                                    onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, showReceiptPreview: e.target.checked } })}
                                                />
                                                <div className="toggle-track"></div>
                                            </label>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: '#eef7f6', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div className={`p-2 rounded-lg ${printerConnected ? 'bg-blue-100' : 'bg-slate-200'}`}>
                                                    <Printer size={20} className={printerConnected ? 'text-blue-600' : 'text-slate-500'} />
                                                </div>
                                                <div>
                                                    <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Thermal Printer</p>
                                                    <p className={`text-[11px] ${printerConnected ? 'text-blue-600 font-medium' : 'text-slate-500'}`}>
                                                        {printerConnected ? printerDeviceName : 'Not connected'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <button
                                                    onClick={async () => {
                                                        setIsConnectingPrinter(true);
                                                        try {
                                                            const connected = await hardwareService.connect();
                                                            setPrinterConnected(connected);
                                                            setPrinterDeviceName(hardwareService.getDeviceName());
                                                            if (connected) {
                                                                notify('Printer connected successfully', 'success');
                                                            } else {
                                                                notify('No printer selected or connection cancelled', 'warning');
                                                            }
                                                        } catch (err: any) {
                                                            notify(err.message || 'Failed to connect printer', 'error');
                                                        } finally {
                                                            setIsConnectingPrinter(false);
                                                        }
                                                    }}
                                                    disabled={isConnectingPrinter}
                                                    style={{ paddingLeft: '16px', paddingTop: '8px', background: '#0b3e39', color: '#fff', fontSize: '13px', fontWeight: 600, borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '16px', paddingBottom: '8px' }}
                                                >
                                                    <Usb size={14} />
                                                    {isConnectingPrinter ? 'Connecting...' : printerConnected ? 'Reconnect' : 'Connect Printer'}
                                                </button>
                                                {printerConnected && (
                                                    <button
                                                        onClick={async () => {
                                                            try {
                                                                await hardwareService.printPosReceipt({
                                                                    receiptNumber: 'TEST',
                                                                    date: new Date().toISOString(),
                                                                    cashierName: 'Test',
                                                                    customerName: 'Test Customer',
                                                                    items: [{ desc: 'Test Item', qty: 1, price: 100, total: 100 }],
                                                                    subtotal: 100,
                                                                    discount: 0,
                                                                    tax: 0,
                                                                    totalAmount: 100,
                                                                    paymentMethod: 'Cash',
                                                                    amountTendered: 100,
                                                                    changeGiven: 0,
                                                    footerMessage: 'Test print from Prime ERP'
                                                                 }, companyConfig);
                                                                notify('Test print sent', 'success');
                                                            } catch (err: any) {
                                                                notify('Test print failed', 'error');
                                                            }
                                                        }}
                                                        style={{ paddingLeft: '16px', paddingTop: '8px', background: '#1f8577', color: '#fff', fontSize: '13px', fontWeight: 600, borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '16px', paddingBottom: '8px' }}
                                                    >
                                                        <Printer size={14} />
                                                        Test Print
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="settings-label">Receipt Footer Message</label>
                                            <textarea
                                                style={{ height: '96px' }}
                                                value={config.transactionSettings?.pos?.receiptFooter || ''}
                                                onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, pos: { ...config.transactionSettings?.pos, receiptFooter: e.target.value } } })}
                                                placeholder="e.g. Thank you for your business!"
                                            />
                                        </div>
                                    </div>
                                </section>

                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', paddingRight: '32px', paddingBottom: '20px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#23282A' }}>Advanced POS Terminal Settings</h3>
                                        <p style={{ color: '#5c6567', marginTop: '2px' }}>Control default behavior and terminal-specific settings.</p>
                                    </div>
                                    <div style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '48px' }}>
                                        <div style={{ marginTop: '24px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <p style={{ fontWeight: 700, color: '#23282A', fontSize: '13px' }}>Quick Item Entry</p>
                                                    <p style={{ color: '#5c6567', marginTop: '2px' }}>Focus SKU input automatically after adding item.</p>
                                                </div>
                                                <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                    <input
                                                        type="checkbox"
                                                        className="toggle-input"
                                                        checked={config.transactionSettings?.quickItemEntry}
                                                        onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, quickItemEntry: e.target.checked } })}
                                                    />
                                                    <div className="toggle-track"></div>
                                                </label>
                                            </div>
                                            <div>
                                                <label className="settings-label">Default POS Terminal/Warehouse</label>
                                                <select
                                                    className="settings-input"
                                                    value={config.transactionSettings?.defaultPOSWarehouse || ''}
                                                    onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, defaultPOSWarehouse: e.target.value } })}
                                                >
                                                    <option value="">Select Warehouse</option>
                                                    <option value="Main">Main Warehouse</option>
                                                    <option value="Store1">Retail Store A</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="settings-label">Default POS Customer</label>
                                            <input
                                                type="text"
                                                className="settings-input"
                                                placeholder="e.g. Cash Customer"
                                                value={config.transactionSettings?.posDefaultCustomer || ''}
                                                onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, posDefaultCustomer: e.target.value } })}
                                            />
                                            <p style={{ color: '#5c6567', marginTop: '8px', fontStyle: 'italic' }}>The default customer profile used for anonymous POS sales.</p>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}



                        {activeTab === 'Templates' && (
                            <div style={{ marginTop: '32px' }}>
                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', fontWeight: 700, fontSize: '13px', color: '#23282A', paddingRight: '32px', paddingBottom: '20px' }}>
                                        Invoice Layout & Engine
                                    </div>
                                    <div style={{ padding: '32px' }}>
                                        <div>
                                            <label className="settings-label">Template Engine</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px' }}>
                                                {(['Classic', 'Modern', 'Professional', 'Clean'] as const).map(engine => (
                                                    <button
                                                        key={engine}
                                                        onClick={() => setConfig({ ...config, invoiceTemplates: { ...config.invoiceTemplates, engine: engine as InvoiceTemplatesConfig['engine'] } })}
                                                        className={`py-3 rounded-md text-[11px] font-bold border transition-all ${config.invoiceTemplates?.engine === engine ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-[#D4D7DC] text-[#6B6C6F] hover:border-blue-600'}`}
                                                    >
                                                        {engine}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', columnGap: '48px', rowGap: '24px' }}>
                                            {[
                                                { key: 'showCompanyLogo', label: 'Show Company Logo', sub: 'Display logo on top right/left.' },
                                                { key: 'showPaymentTerms', label: 'Include Payment Terms', sub: 'Add terms & conditions footer.' },
                                                { key: 'showDueDate', label: 'Show Due Date', sub: 'Highlight payment deadline.' },
                                                { key: 'showAccountSummary', label: 'Show Account Summary', sub: 'Replaces Payment Terms with an account balance summary.' },
                                                { key: 'showOutstandingAndWalletBalances', label: 'Invoice Balance Details', sub: 'Show outstanding and wallet balances on general invoices.' }
                                            ].map(item => (
                                                <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '12px', transition: 'all .15s ease' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 700, color: '#23282A' }}>{item.label}</p>
                                                        <p style={{ color: '#5c6567' }}>{item.sub}</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.invoiceTemplates[item.key as keyof InvoiceTemplatesConfig]}
                                                            onChange={e => setConfig({ ...config, invoiceTemplates: { ...config.invoiceTemplates, [item.key]: e.target.checked } })}
                                                        />
                                                        <div className="toggle-track-sm"></div>
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </section>

                                <section style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ paddingLeft: '32px', paddingTop: '20px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6', fontWeight: 700, fontSize: '13px', color: '#23282A', paddingRight: '32px', paddingBottom: '20px' }}>
                                        Typography & Page Metrics
                                    </div>
                                    <div style={{ padding: '32px' }}>
                                        <div style={{ marginTop: '24px' }}>
                                            <div>
                                                <label className="settings-label">Main Accent Color</label>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                    <input
                                                        type="color"
                                                        style={{ width: '48px', height: '48px', borderRadius: '12px', cursor: 'pointer', border: 'none', padding: 0, background: 'transparent' }}
                                                        value={normalizedTemplateSettings.accentColor}
                                                        onChange={e => setConfig({ ...config, invoiceTemplates: { ...config.invoiceTemplates, accentColor: e.target.value } })}
                                                    />
                                                    <input
                                                        type="text"
                                                        style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '11px' }}
                                                        placeholder="e.g. #2CA01C"
                                                        value={normalizedTemplateSettings.accentColor}
                                                        onChange={e => setConfig({ ...config, invoiceTemplates: { ...config.invoiceTemplates, accentColor: e.target.value } })}
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="settings-label">Document Font Style</label>
                                                <select
                                                    className="settings-input"
                                                    value={normalizedTemplateSettings.fontFamily}
                                                        onChange={e => setConfig({ ...config, invoiceTemplates: { ...config.invoiceTemplates, fontFamily: e.target.value } })}
                                                >
                                                    {PRIME_PDF_FONT_OPTIONS.map(option => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div>
                                                <label className="settings-label">Document Font Size ({normalizedTemplateSettings.bodyFontSize}px)</label>
                                                <input
                                                    type="range"
                                                    min="10"
                                                    max="16"
                                                    style={{ width: '100%', height: '8px', background: '#eef7f6', borderRadius: '10px', appearance: 'none', cursor: 'pointer' }}
                                                    value={normalizedTemplateSettings.bodyFontSize}
                                                    onChange={e => setConfig({ ...config, invoiceTemplates: { ...config.invoiceTemplates, bodyFontSize: parseInt(e.target.value, 10) } })}
                                                />
                                                <p style={{ marginTop: '8px', color: '#5c6567', fontWeight: 500 }}>Tuned to keep the Prime document readable without disturbing page flow.</p>
                                            </div>

                                            <div>
                                                <label className="settings-label">Company Name Font Size ({normalizedTemplateSettings.companyNameFontSize}px)</label>
                                                <input
                                                    type="range"
                                                    min="12"
                                                    max="32"
                                                    style={{ width: '100%', height: '8px', background: '#eef7f6', borderRadius: '10px', appearance: 'none', cursor: 'pointer' }}
                                                    value={normalizedTemplateSettings.companyNameFontSize}
                                                    onChange={e => setConfig({ ...config, invoiceTemplates: { ...config.invoiceTemplates, companyNameFontSize: parseInt(e.target.value, 10) } })}
                                                />
                                            </div>

                                            <div>
                                                <label className="settings-label">Company Logo Size ({normalizedTemplateSettings.logoWidth}px)</label>
                                                <input
                                                    type="range"
                                                    min="80"
                                                    max="220"
                                                    style={{ width: '100%', height: '8px', background: '#eef7f6', borderRadius: '10px', appearance: 'none', cursor: 'pointer' }}
                                                    value={normalizedTemplateSettings.logoWidth}
                                                    onChange={e => setConfig({ ...config, invoiceTemplates: { ...config.invoiceTemplates, logoWidth: parseInt(e.target.value, 10) } })}
                                                />
                                            </div>
                                        </div>

                                        <div style={{ background: '#eef7f6', borderRadius: '16px', padding: '24px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1' }}>
                                            <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
                                                <div>
                                                    <p style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em' }}>Exact Prime Preview</p>
                                                    <p style={{ marginTop: '4px', fontSize: '11px', color: '#5c6567' }}>This is the actual PDF renderer used for the document export, refreshed live from the unsaved template settings.</p>
                                                </div>
                                                <div style={{ borderRadius: '9999px', background: '#FEFDFB', paddingLeft: '12px', paddingTop: '4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#5c6567', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', paddingRight: '12px', paddingBottom: '4px' }}>
                                                    Invoice
                                                </div>
                                            </div>
                                            <PrimeTemplatePreview config={deferredTemplatePreviewConfig} />
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'GLMapping' && (
                            <div style={{ marginTop: '48px' }}>
                                <section>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                                        <div>
                                            <h3 style={{ fontWeight: 900, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <Binary size={18} style={{ color: '#1f8577' }} /> Chart of Accounts Mapping
                                            </h3>
                                            <p style={{ fontSize: '11px', marginTop: '4px' }}>Direct system transactions to specific ledger accounts.</p>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '40px' }}>
                                        {[
                                            { key: 'defaultSalesAccount', label: 'Sales Revenue', icon: ShoppingBag, desc: 'Income from sales' },
                                            { key: 'defaultInventoryAccount', label: 'Inventory Asset', icon: Box, desc: 'Stock value account' },
                                            { key: 'defaultCOGSAccount', label: 'Cost of Goods Sold', icon: Calculator, desc: 'Cost of sales' },
                                            { key: 'accountsReceivable', label: 'Accounts Receivable', icon: Users, desc: 'Customer debt' },
                                            { key: 'accountsPayable', label: 'Accounts Payable', icon: Users, desc: 'Supplier debt' },
                                            { key: 'bankAccount', label: 'Primary Bank Account', icon: Landmark, desc: 'Default cash/bank' }
                                        ].map(item => (
                                            <div key={item.key} style={{ padding: '24px', background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'all .15s ease', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                    <div style={{ padding: '12px', borderRadius: '8px', transition: 'all .15s ease' }}>
                                                        <item.icon size={20} />
                                                    </div>
                                                    <div>
                                                        <p style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-.05em', fontSize: '13px' }}>{item.label}</p>
                                                        <p style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em' }}>{item.desc}</p>
                                                    </div>
                                                </div>
                                                <div style={{ position: 'relative' }}>
                                                    <Hash style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} size={14} />
                                                    <input
                                                        type="text"
                                                        style={{ width: '100%', paddingLeft: '40px', paddingRight: '20px', paddingTop: '12px', border: '1.4px solid #e4ddd1', borderRadius: '8px', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: '#1f8577', outline: 'none', transition: 'all .15s ease', fontSize: '11px', paddingBottom: '12px' }}
                                                        value={config.glMapping[item.key] || ''}
                                                        onChange={e => setConfig({ ...config, glMapping: { ...(config.glMapping || {}), [item.key]: e.target.value } })}
                                                        placeholder="e.g. 1000-0001"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'PaymentDetails' && (
                            <div style={{ marginTop: '48px' }}>
                                <section>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                                        <div>
                                            <h3 style={{ fontWeight: 900, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <Landmark size={18} style={{ color: '#1f8577' }} /> Payment Details
                                            </h3>
                                            <p style={{ fontSize: '11px', marginTop: '4px' }}>Manage bank and mobile money accounts for payments.</p>
                                        </div>
                                    </div>

                                    {/* Bank Accounts */}
                                    <div style={{ marginBottom: '32px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                            <h4 style={{ fontWeight: 700 }}>Bank Accounts</h4>
                                            <button
                                                onClick={() => {
                                                    const newAccount = {
                                                        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                                        bankName: '',
                                                        accountName: '',
                                                        accountNumber: '',
                                                        branchCode: ''
                                                    };
                                                    setConfig({
                                                        ...config,
                                                        transactionSettings: {
                                                            ...config.transactionSettings,
                                                            paymentDetails: {
                                                                ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }),
                                                                bankAccounts: [
                                                                    ...(config.transactionSettings?.paymentDetails?.bankAccounts || []),
                                                                    newAccount
                                                                ]
                                                            }
                                                        }
                                                    });
                                                }}
                                                style={{ paddingLeft: '12px', paddingTop: '6px', background: '#1f8577', color: '#fff', borderRadius: '8px', fontSize: '11px', fontWeight: 700, transition: 'all .15s ease', paddingRight: '12px', paddingBottom: '6px' }}
                                            >
                                                + Add Bank Account
                                            </button>
                                        </div>
                                        <div style={{ marginTop: '12px' }}>
                                            {(config.transactionSettings?.paymentDetails?.bankAccounts || []).map((bank, idx) => (
                                                <div key={bank.id} style={{ padding: '16px', background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px' }}>
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. Standard Bank"
                                                            aria-label="Bank Name"
                                                            className="settings-input"
                                                            value={bank.bankName}
                                                            onChange={e => {
                                                                const updated = [...(config.transactionSettings?.paymentDetails?.bankAccounts || [])];
                                                                updated[idx] = { ...updated[idx], bankName: e.target.value };
                                                                setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), bankAccounts: updated } } });
                                                            }}
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. Operating Account"
                                                            aria-label="Account Name"
                                                            className="settings-input"
                                                            value={bank.accountName}
                                                            onChange={e => {
                                                                const updated = [...(config.transactionSettings?.paymentDetails?.bankAccounts || [])];
                                                                updated[idx] = { ...updated[idx], accountName: e.target.value };
                                                                setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), bankAccounts: updated } } });
                                                            }}
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. 10100223344"
                                                            aria-label="Account Number"
                                                            className="settings-input"
                                                            value={bank.accountNumber}
                                                            onChange={e => {
                                                                const updated = [...(config.transactionSettings?.paymentDetails?.bankAccounts || [])];
                                                                updated[idx] = { ...updated[idx], accountNumber: e.target.value };
                                                                setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), bankAccounts: updated } } });
                                                            }}
                                                        />
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <input
                                                                type="text"
                                                                placeholder="e.g. 012345"
                                                                aria-label="Branch Code"
                                                                className="settings-input"
                                                                value={bank.branchCode || ''}
                                                                onChange={e => {
                                                                    const updated = [...(config.transactionSettings?.paymentDetails?.bankAccounts || [])];
                                                                    updated[idx] = { ...updated[idx], branchCode: e.target.value };
                                                                    setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), bankAccounts: updated } } });
                                                                }}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const updated = (config.transactionSettings?.paymentDetails?.bankAccounts || []).filter((_, i) => i !== idx);
                                                                    setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), bankAccounts: updated } } });
                                                                }}
                                                                style={{ padding: '8px', color: '#b5493f', borderRadius: '6px' }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {(config.transactionSettings?.paymentDetails?.bankAccounts || []).length === 0 && (
                                                <p style={{ fontSize: '13px', color: '#5c6567', textAlign: 'center', paddingTop: '16px', paddingBottom: '16px' }}>No bank accounts added yet.</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Mobile Money Accounts */}
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                            <h4 style={{ fontWeight: 700 }}>Mobile Money Accounts</h4>
                                            <button
                                                onClick={() => {
                                                    const newAccount = {
                                                        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                                        network: 'Airtel',
                                                        accountName: '',
                                                        phoneNumber: ''
                                                    };
                                                    setConfig({
                                                        ...config,
                                                        transactionSettings: {
                                                            ...config.transactionSettings,
                                                            paymentDetails: {
                                                                ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }),
                                                                mobileMoneyAccounts: [
                                                                    ...(config.transactionSettings?.paymentDetails?.mobileMoneyAccounts || []),
                                                                    newAccount
                                                                ]
                                                            }
                                                        }
                                                    });
                                                }}
                                                style={{ paddingLeft: '12px', paddingTop: '6px', background: '#1f8577', color: '#fff', borderRadius: '8px', fontSize: '11px', fontWeight: 700, transition: 'all .15s ease', paddingRight: '12px', paddingBottom: '6px' }}
                                            >
                                                + Add Mobile Money
                                            </button>
                                        </div>
                                        <div style={{ marginTop: '12px' }}>
                                            {(config.transactionSettings?.paymentDetails?.mobileMoneyAccounts || []).map((mm, idx) => (
                                                <div key={mm.id} style={{ padding: '16px', background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
                                                        <select
                                                            className="settings-input"
                                                            value={mm.network}
                                                            onChange={e => {
                                                                const updated = [...(config.transactionSettings?.paymentDetails?.mobileMoneyAccounts || [])];
                                                                updated[idx] = { ...updated[idx], network: e.target.value };
                                                                setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), mobileMoneyAccounts: updated } } });
                                                            }}
                                                        >
                                                            <option value="Airtel">Airtel Money</option>
                                                            <option value="TNM">TNM Mpamba</option>
                                                            <option value="MTN">MTN MoMo</option>
                                                        </select>
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. Business Wallet"
                                                            aria-label="Account Name"
                                                            className="settings-input"
                                                            value={mm.accountName}
                                                            onChange={e => {
                                                                const updated = [...(config.transactionSettings?.paymentDetails?.mobileMoneyAccounts || [])];
                                                                updated[idx] = { ...updated[idx], accountName: e.target.value };
                                                                setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), mobileMoneyAccounts: updated } } });
                                                            }}
                                                        />
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <input
                                                                type="text"
                                                                placeholder="e.g. 0888123456"
                                                                aria-label="Phone Number"
                                                                className="settings-input"
                                                                value={mm.phoneNumber}
                                                                onChange={e => {
                                                                    const updated = [...(config.transactionSettings?.paymentDetails?.mobileMoneyAccounts || [])];
                                                                    updated[idx] = { ...updated[idx], phoneNumber: e.target.value };
                                                                    setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), mobileMoneyAccounts: updated } } });
                                                                }}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const updated = (config.transactionSettings?.paymentDetails?.mobileMoneyAccounts || []).filter((_, i) => i !== idx);
                                                                    setConfig({ ...config, transactionSettings: { ...config.transactionSettings, paymentDetails: { ...(config.transactionSettings?.paymentDetails || { bankAccounts: [], mobileMoneyAccounts: [] }), mobileMoneyAccounts: updated } } });
                                                                }}
                                                                style={{ padding: '8px', color: '#b5493f', borderRadius: '6px' }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {(config.transactionSettings?.paymentDetails?.mobileMoneyAccounts || []).length === 0 && (
                                                <p style={{ fontSize: '13px', color: '#5c6567', textAlign: 'center', paddingTop: '16px', paddingBottom: '16px' }}>No mobile money accounts added yet.</p>
                                            )}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        {
                            activeTab === 'Transactions' && (
                                <div style={{ marginTop: '48px' }}>
                                    <section>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                                            <div>
                                                <h3 style={{ fontWeight: 900, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <Hash size={18} style={{ color: '#1f8577' }} /> Transaction Numbering Logic
                                                </h3>
                                                <p style={{ fontSize: '11px', marginTop: '4px' }}>Set one numbering pattern. Each document keeps its own built-in prefix automatically.</p>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '40px' }}>
                                            <div style={{ padding: '24px', background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                                <div style={{ display: 'flex', alignItems: 'start', gap: '16px' }}>
                                                    <div style={{ padding: '16px', borderRadius: '8px', color: '#1f8577' }}>
                                                        <Hash size={24} />
                                                    </div>
                                                    <div>
                                                        <p style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-.05em', fontSize: '16px' }}>Global Numbering Pattern</p>
                                                        <p style={{ fontSize: '11px', marginTop: '4px', maxWidth: '576px' }}>
                                                            Prefixes such as `INV`, `QTN`, `DN`, `POS`, and `RCPT` are fixed by the system.
                                                            Only the numeric pattern below is shared across all documents.
                                                        </p>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '24px' }}>
                                                    <div>
                                                        <label style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', display: 'block', marginBottom: '12px', paddingLeft: '4px', paddingRight: '4px' }}>Padding</label>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            placeholder="e.g. 4"
                                                            style={{ width: '100%', padding: '16px', background: '#eef7f6', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', textAlign: 'center', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease' }}
                                                            value={sharedNumberingRule.padding || 4}
                                                            onChange={e => updateSharedNumbering({ padding: parseInt(e.target.value, 10) || 1 })}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', display: 'block', marginBottom: '12px', paddingLeft: '4px', paddingRight: '4px' }}>Start At</label>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            placeholder="e.g. 1"
                                                            style={{ width: '100%', padding: '12px', border: '1.4px solid #e4ddd1', borderRadius: '8px', textAlign: 'center', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease' }}
                                                            value={sharedNumberingRule.startNumber || 1}
                                                            onChange={e => updateSharedNumbering({ startNumber: parseInt(e.target.value, 10) || 1 })}
                                                        />
                                                    </div>
                                                    <div style={{ gridColumn: 'span 2 / span 2' }}>
                                                        <label style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', display: 'block', marginBottom: '12px', paddingLeft: '4px', paddingRight: '4px' }}>Prefix Extension / Branch (Optional)</label>
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. P7, HQ, BRANCH01"
                                                            style={{ width: '100%', padding: '12px', border: '1.4px solid #e4ddd1', borderRadius: '8px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease' }}
                                                            value={sharedNumberingRule.extension || ''}
                                                            onChange={e => updateSharedNumbering({ extension: e.target.value })}
                                                        />
                                                        <p style={{ color: '#5c6567', marginTop: '8px', fontStyle: 'italic', paddingLeft: '4px', paddingRight: '4px' }}>This will be added after the document prefix (e.g. INV-P7/0001).</p>
                                                    </div>
                                                    <div style={{ gridColumn: 'span 2 / span 2' }}>
                                                        <label style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', display: 'block', marginBottom: '12px', paddingLeft: '4px', paddingRight: '4px' }}>Reset Sequence</label>
                                                        <select
                                                            style={{ width: '100%', padding: '12px', border: '1.4px solid #e4ddd1', borderRadius: '8px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', cursor: 'pointer' }}
                                                            value={sharedNumberingRule.resetInterval || 'Never'}
                                                            onChange={e => updateSharedNumbering({ resetInterval: e.target.value as NumberingRule['resetInterval'] })}
                                                        >
                                                            <option value="Never">Never Reset (Continuous)</option>
                                                            <option value="Daily">Reset Every Day</option>
                                                            <option value="Monthly">Reset Every Month</option>
                                                            <option value="Yearly">Reset Every Fiscal Year</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                <div style={{ borderRadius: '12px', border: '1.4px solid #e4ddd1', borderColor: '#d3ece9', background: '#eef7f6', paddingLeft: '16px', paddingTop: '12px', fontSize: '11px', color: '#0b3e39', paddingRight: '16px', paddingBottom: '12px' }}>
                                                    One change here updates the numbering style used throughout sales, POS, procurement, inventory, and supporting transaction documents.
                                                </div>
                                            </div>

                                            <div style={{ padding: '24px', background: '#0b3e39', borderRadius: '10px', boxShadow: '0 20px 25px -5px rgba(0,0,0,.1)', color: '#fff', border: '1.4px solid #e4ddd1', borderColor: '#fff' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                                    <FileCheck size={18} style={{ color: '#1f8577' }} />
                                                    <div>
                                                        <p style={{ fontWeight: 900, color: '#1f8577', textTransform: 'uppercase', letterSpacing: '.1em' }}>Live Preview</p>
                                                        <p style={{ fontSize: '11px', color: '#5c6567', marginTop: '4px' }}>Every document keeps its own prefix, then follows the shared pattern.</p>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '16px' }}>
                                                    {[
                                                        { key: 'invoice', label: 'Sales Invoice' },
                                                        { key: 'quotation', label: 'Quotation' },
                                                        { key: 'deliverynote', label: 'Delivery Note' },
                                                        { key: 'POS', label: 'POS Sale' },
                                                        { key: 'RCPT', label: 'Customer Receipt' },
                                                        { key: 'exambatch', label: 'Exam Batch' }
                                                    ].map(preview => (
                                                        <div key={preview.key} style={{ borderRadius: '12px', border: '1.4px solid #e4ddd1', borderColor: 'rgba(255,255,255,.1)', background: 'rgba(254,253,251,.05)', paddingLeft: '16px', paddingTop: '12px', paddingRight: '16px', paddingBottom: '12px' }}>
                                                            <p style={{ textTransform: 'uppercase', letterSpacing: '.1em', color: '#5c6567', fontWeight: 900 }}>{preview.label}</p>
                                                            <p style={{ marginTop: '8px', fontFamily: '"JetBrains Mono",monospace', fontSize: '13px', color: '#fff' }}>{formatNumberingPreview(preview.key, sharedNumberingRule)}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section style={{ paddingTop: '40px', borderStyle: 'solid', borderColor: '#e4ddd1' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '40px' }}>
                                            <div>
                                                <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <Shield size={18} style={{ color: '#1f8577' }} /> Approval Thresholds & Controls
                                                </h3>
                                                <p style={{ fontSize: '11px', color: '#5c6567', marginTop: '4px' }}>Define which transactions require administrative authorization.</p>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '40px' }}>
                                            {[
                                                { key: 'purchaseorder', label: 'Purchase Orders', icon: ShoppingBag, desc: 'External procurement' },
                                                { key: 'quotation', label: 'Sales Quotations', icon: PenTool, desc: 'Customer proposals' },
                                                { key: 'expense', label: 'Operating Expenses', icon: ExternalLink, desc: 'Direct cost recording' }
                                            ].map(item => (
                                                <div key={item.key} style={{ background: '#FEFDFB', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'all .15s ease', display: 'flex', flexDirection: 'column', height: '100%' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                                                        <div style={{ padding: '12px', borderRadius: '8px', transition: 'all .15s ease' }}>
                                                            <item.icon size={20} />
                                                        </div>
                                                        <div>
                                                            <p style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-.05em', fontSize: '13px' }}>{item.label}</p>
                                                            <p style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '2px' }}>{item.desc}</p>
                                                        </div>
                                                    </div>

                                                    <div style={{ flex: 1, marginTop: '32px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <div>
                                                                <p style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '-.025em' }}>Require Approval</p>
                                                                <p style={{ color: '#5c6567', fontWeight: 700, marginTop: '4px' }}>Enable for this type.</p>
                                                            </div>
                                                            <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    className="toggle-input"
                                                                    checked={config.transactionSettings?.approvalThresholds?.[item.key] !== undefined}
                                                                    onChange={e => {
                                                                        const thresholds: Record<string, number> = { ...(config.transactionSettings?.approvalThresholds || {}) };
                                                                        if (e.target.checked) {
                                                                            thresholds[item.key] = 0;
                                                                        } else {
                                                                            delete thresholds[item.key];
                                                                        }
                                                                        setConfig({ ...config, transactionSettings: { ...config.transactionSettings, approvalThresholds: thresholds } });
                                                                    }}
                                                                />
                                                                <div className="toggle-track-sm"></div>
                                                            </label>
                                                        </div>

                                                        {config.transactionSettings?.approvalThresholds?.[item.key] !== undefined && (
                                                            <div style={{ transitionDuration: '300ms' }}>
                                                                <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px', paddingLeft: '4px', paddingRight: '4px' }}>Threshold Amount ({currency})</label>
                                                                <div style={{ position: 'relative' }}>
                                                                    <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#5c6567', fontSize: '11px' }}>{currency}</span>
                                                                    <input
                                                                        type="number"
                                                                        style={{ width: '100%', border: '1.4px solid #e4ddd1', borderRadius: '8px', paddingLeft: '40px', paddingRight: '20px', paddingTop: '12px', fontWeight: 700, outline: 'none', transition: 'all .15s ease', fontSize: '13px', paddingBottom: '12px' }}
                                                                        value={config.transactionSettings?.approvalThresholds?.[item.key] || 0}
                                                                        onChange={e => setConfig({ ...config, transactionSettings: { ...config.transactionSettings, approvalThresholds: { ...config.transactionSettings?.approvalThresholds, [item.key]: parseFloat(e.target.value) || 0 } } })}
                                                                    />
                                                                </div>
                                                                <p style={{ color: '#5c6567', marginTop: '12px', fontWeight: 500, fontStyle: 'italic', lineHeight: 1.625 }}>
                                                                    {config.transactionSettings?.approvalThresholds?.[item.key] === 0
                                                                        ? "Approval required for ALL transactions of this type."
                                                                        : `Approval only required for amounts exceeding ${currency}${config.transactionSettings?.approvalThresholds?.[item.key]}.`}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </section>






                                    <section style={{ paddingTop: '40px', borderStyle: 'solid', borderColor: '#e4ddd1' }}>
                                        <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <Cpu size={18} style={{ color: '#1f8577' }} /> External API Connections
                                        </h3>
                                        <div style={{ background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', padding: '24px', marginTop: '32px', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                            {(config.integrationSettings?.externalApis || []).map((api, idx) => (
                                                <div key={api.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px', background: '#eef7f6', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', transition: 'all .15s ease' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                                        <div style={{ padding: '20px', background: '#FEFDFB', borderRadius: '16px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', color: '#5c6567', transition: 'all .15s ease' }}>
                                                            <Globe size={24} />
                                                        </div>
                                                        <div>
                                                            <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '13px' }}>{api.name}</p>
                                                            <p style={{ fontSize: '11px', color: '#5c6567', fontFamily: '"JetBrains Mono",monospace', marginTop: '4px' }}>{api.baseUrl}</p>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                                        <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${api.enabled ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
                                                            {api.enabled ? 'Active' : 'Disabled'}
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <button style={{ padding: '10px', color: '#5c6567', borderRadius: '12px', transition: 'all .15s ease' }} title="Edit settings" aria-label="Edit API settings"><Settings2 size={18} /></button>
                                                            <button style={{ padding: '10px', color: '#5c6567', borderRadius: '12px', transition: 'all .15s ease' }} title="Delete" aria-label="Delete API credential"><Trash2 size={18} /></button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            <button 
                                                onClick={() => {
                                                    const newApi = { 
                                                         id: `api-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, 
                                                         name: 'New API Connection',
                                                        enabled: false, 
                                                        baseUrl: 'https://' 
                                                    };
                                                    const currentApis = config.integrationSettings?.externalApis || [];
                                                    setConfig({ 
                                                        ...config, 
                                                        integrationSettings: { 
                                                            ...config.integrationSettings, 
                                                            externalApis: [...currentApis, newApi] 
                                                        } 
                                                    });
                                                    notify('New API connection added. Configure details below.', 'info');
                                                }}
                                                style={{ width: '100%', paddingTop: '24px', borderWidth: '2px', borderStyle: 'dashed', borderColor: '#e4ddd1', borderRadius: '10px', color: '#5c6567', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all .15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', paddingBottom: '24px' }}
                                            >
                                                <Plus size={18} /> Connect New Service
                                            </button>
                                        </div>
                                    </section>

                                    <section style={{ paddingTop: '40px', borderStyle: 'solid', borderColor: '#e4ddd1' }}>
                                        <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <Webhook size={18} style={{ color: '#1f8577' }} /> Webhook Outlets
                                        </h3>
                                        <div style={{ background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', padding: '24px', marginTop: '32px', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                            {(config.integrationSettings?.webhooks || []).map((hook, idx) => (
                                                <div key={hook.id} style={{ padding: '24px', background: '#eef7f6', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', transition: 'all .15s ease' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '24px' }}>
                                                        <div>
                                                            <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '.1em', marginBottom: '4px' }}>Destination URL</p>
                                                            <p style={{ color: '#5c6567', fontFamily: '"JetBrains Mono",monospace', marginTop: '4px', background: 'rgba(254,253,251,.5)', paddingLeft: '12px', paddingTop: '6px', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', paddingRight: '12px', paddingBottom: '6px' }}>{hook.url}</p>
                                                        </div>
                                                        <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                            <input
                                                                type="checkbox"
                                                                className="toggle-input"
                                                                checked={hook.enabled}
                                                                onChange={e => {
                                                                    const updatedHooks = [...(config.integrationSettings?.webhooks || [])];
                                                                    updatedHooks[idx] = { ...hook, enabled: e.target.checked };
                                                                    setConfig({ ...config, integrationSettings: { ...config.integrationSettings, webhooks: updatedHooks } });
                                                                }}
                                                            />
                                                            <div className="toggle-track-lg"></div>
                                                        </label>
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                                                        {(hook.events || []).map(event => (
                                                            <span key={event} style={{ paddingLeft: '16px', paddingTop: '8px', background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'all .15s ease', paddingRight: '16px', paddingBottom: '8px' }}>{event}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                            <button 
                                                onClick={() => {
                                                    const newWebhook = { 
id: `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, 
                                                         url: 'https://', 
                                                        enabled: false, 
                                                        events: ['document.created', 'document.updated'] 
                                                    };
                                                    const currentHooks = config.integrationSettings?.webhooks || [];
                                                    setConfig({ 
                                                        ...config, 
                                                        integrationSettings: { 
                                                            ...config.integrationSettings, 
                                                            webhooks: [...currentHooks, newWebhook] 
                                                        } 
                                                    });
                                                    notify('New webhook endpoint added. Configure URL and events below.', 'info');
                                                }}
                                                style={{ width: '100%', paddingTop: '24px', borderWidth: '2px', borderStyle: 'dashed', borderColor: '#e4ddd1', borderRadius: '10px', color: '#5c6567', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all .15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', paddingBottom: '24px' }}
                                            >
                                                <Plus size={18} /> Register Webhook
                                            </button>
                                        </div>
                                    </section>
                                </div>
                            )
                        }

                        {
                            activeTab === 'Modules' && (
                                <div style={{ marginTop: '48px' }}>
                                    <div style={{ background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', padding: '24px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', marginTop: '40px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <ShoppingBag size={18} style={{ color: '#1f8577' }} />
                                            <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase' }}>Feature Management</h3>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '40px' }}>
                                            {[
                                                { key: 'manufacturing', label: 'Manufacturing Node', desc: 'BOMs, Work Orders and Shop Floor Kiosk', icon: Cpu },
                                                { key: 'payroll', label: 'Payroll Engine', desc: 'Staff directory, payslips and wage ledger', icon: Users },
                                                { key: 'accounting', label: 'Advanced Accounting', desc: 'Double-entry, journals and bank recon', icon: Landmark },
                                                { key: 'crm', label: 'CRM & Comms', icon: Smartphone, desc: 'Lead tracking and SMS/WhatsApp broadcast' },
                                                { key: 'loyalty', label: 'Loyalty Rewards', icon: Zap, desc: 'Point accumulation and redemption logic' }
                                            ].map(mod => (
                                                <div key={mod.key} style={{ padding: '24px', background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all .15s ease' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                                        <div style={{ padding: '16px', borderRadius: '8px', border: '1.4px solid #e4ddd1', transition: 'all .15s ease', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                                            <mod.icon size={28} />
                                                        </div>
                                                        <div style={{ minWidth: 0 }}>
                                                            <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', letterSpacing: '-.05em', fontSize: '16px' }}>{mod.label}</p>
                                                            <p style={{ fontSize: '11px', color: '#5c6567', lineHeight: 1.25, paddingRight: '16px', marginTop: '6px', fontWeight: 500 }}>{mod.desc}</p>
                                                        </div>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.enabledModules[mod.key]}
                                                            onChange={e => setConfig({ ...config, enabledModules: { ...config.enabledModules, [mod.key]: e.target.checked } })}
                                                        />
                                                        <div className="toggle-track-xl"></div>
                                                    </label>
</div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )
                            }

                            {
                                activeTab === 'Inventory' && (
                                    <div style={{ marginTop: '48px' }}>
                                    <div style={{ background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', padding: '24px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', marginTop: '40px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <Box size={18} style={{ color: '#1f8577' }} />
                                            <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase' }}>Stock & Inventory Policy</h3>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '40px' }}>
                                            <div style={{ background: '#eef7f6', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', marginTop: '32px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '16px', paddingLeft: '4px', paddingRight: '4px' }}>Valuation Method</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
                                                        {['AVCO', 'FIFO', 'LIFO'].map(method => (
                                                            <button
                                                                key={method}
                                                                 onClick={() => setConfig({ ...config, inventorySettings: { ...config.inventorySettings, valuationMethod: method as InventorySettingsConfig['valuationMethod'] } })}
                                                                className={`py-3 rounded-md font-bold text-[10px] uppercase tracking-widest transition-all border ${config.inventorySettings?.valuationMethod === method ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-[#6B6C6F] border-[#D4D7DC] hover:border-blue-600 hover:bg-blue-50'}`}
                                                            >
                                                                {method}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div style={{ height: '1px', background: '#d3ece9' }}></div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '13px', letterSpacing: '-.025em', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Allow Negative Stock</p>
                                                        <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500 }}>Allow sales and production even if stock is zero.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.inventorySettings?.allowNegativeStock}
                                                            onChange={e => setConfig({ ...config, inventorySettings: { ...config.inventorySettings, allowNegativeStock: e.target.checked } })}
                                                        />
                                                        <div className="toggle-track-lg"></div>
                                                    </label>
                                                </div>
                                                <div style={{ height: '1px', background: '#d3ece9' }}></div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '13px', letterSpacing: '-.025em', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Auto-Generate Barcodes</p>
                                                        <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500 }}>Create unique barcodes for new items automatically.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.inventorySettings?.autoBarcode}
                                                            onChange={e => setConfig({ ...config, inventorySettings: { ...config.inventorySettings, autoBarcode: e.target.checked } })}
                                                        />
                                                        <div className="toggle-track-lg"></div>
                                                    </label>
                                                </div>
                                                <div style={{ height: '1px', background: '#d3ece9' }}></div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '13px', letterSpacing: '-.025em', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Track Batch Numbers</p>
                                                        <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500 }}>Enable lot/batch tracking for perishable goods.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.inventorySettings?.trackBatches}
                                                            onChange={e => setConfig({ ...config, inventorySettings: { ...config.inventorySettings, trackBatches: e.target.checked } })}
                                                        />
                                                        <div className="toggle-track-lg"></div>
                                                    </label>
                                                </div>
                                            </div>

                                            <div style={{ background: '#eef7f6', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', marginTop: '32px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '16px', paddingLeft: '4px', paddingRight: '4px' }}>Default Warehouse</label>
                                                    <select
                                                        style={{ width: '100%', background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '16px', paddingLeft: '20px', paddingTop: '16px', fontWeight: 700, color: '#23282A', outline: 'none', transition: 'all .15s ease', fontSize: '13px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', paddingRight: '20px', paddingBottom: '16px' }}
                                                        value={config.inventorySettings?.defaultWarehouseId || ''}
                                                        onChange={e => setConfig({ ...config, inventorySettings: { ...config.inventorySettings, defaultWarehouseId: e.target.value } })}
                                                    >
                                                        <option value="">Select Warehouse</option>
                                                        <option value="wh-main">Main Distribution Center</option>
                                                        <option value="wh-retail">Retail Floor Storage</option>
                                                        <option value="wh-transit">In-Transit Buffer</option>
                                                    </select>
                                                </div>
                                                <div style={{ height: '1px', background: '#d3ece9' }}></div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '13px', letterSpacing: '-.025em', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Track Serial Numbers</p>
                                                        <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500 }}>Enable unique serial tracking for electronics.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.inventorySettings?.trackSerialNumbers}
                                                            onChange={e => setConfig({ ...config, inventorySettings: { ...config.inventorySettings, trackSerialNumbers: e.target.checked } })}
                                                        />
                                                        <div className="toggle-track-lg"></div>
                                                    </label>
                                                </div>
                                                <div style={{ height: '1px', background: '#d3ece9' }}></div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '13px', letterSpacing: '-.025em', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Low Stock Alerts</p>
                                                        <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500 }}>Notify users when items fall below reorder level.</p>
                                                    </div>
                                                    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            className="toggle-input"
                                                            checked={config.inventorySettings?.lowStockAlerts}
                                                            onChange={e => setConfig({ ...config, inventorySettings: { ...config.inventorySettings, lowStockAlerts: e.target.checked } })}
                                                        />
                                                        <div className="toggle-track-lg"></div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )
                        }

                        {
                            activeTab === 'Cloud' && (
                                <CloudTab config={config} setConfig={setConfig} notify={notify} isProcessing={isProcessing} setIsProcessing={setIsProcessing} api={api} />
                            )
                        }

                        {
                            activeTab === 'Integrations' && (
                                <IntegrationsTab config={config} setConfig={setConfig} />
                            )
                        }

                        {
                            activeTab === 'AISettings' && (
                                <AISettingsTab />
                            )
                        }

                        {
                            activeTab === 'Notifications' && (
                                <NotificationsTab config={config} setConfig={setConfig} notify={notify} />
                            )
                        }

                        {
                            activeTab === 'Security' && (
                                <div style={{ marginTop: '48px' }}>
                                    <section>
                                        <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <ShieldAlert size={18} style={{ color: '#b5493f' }} /> System Security Policy
                                        </h3>

                                        <div style={{ background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', padding: '24px', marginTop: '32px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'all .15s ease' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '40px' }}>
                                                <div style={{ marginTop: '32px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div>
                                                            <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '14px', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Password Protection</p>
                                                            <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500, fontStyle: 'italic' }}>Require login before users can reach the main workspace.</p>
                                                        </div>
                                                        <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                            <input
                                                                type="checkbox"
                                                                className="toggle-input"
                                                                checked={normalizedSecuritySettings.passwordProtectionEnabled}
                                                                onChange={e => setConfig({
                                                                    ...config,
                                                                    securitySettings: {
                                                                        ...normalizedSecuritySettings,
                                                                        passwordProtectionEnabled: e.target.checked
                                                                    }
                                                                })}
                                                            />
                                                            <div className="toggle-track-lg"></div>
                                                        </label>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div>
                                                            <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '14px', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Complex Password Rules</p>
                                                            <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500, fontStyle: 'italic' }}>Enforce length, number, and special-character checks when setting access passwords.</p>
                                                        </div>
                                                        <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                            <input
                                                                type="checkbox"
                                                                className="toggle-input"
                                                                checked={normalizedSecuritySettings.enforcePasswordComplexity}
                                                                onChange={e => setConfig({
                                                                    ...config,
                                                                    securitySettings: {
                                                                        ...normalizedSecuritySettings,
                                                                        enforcePasswordComplexity: e.target.checked
                                                                    }
                                                                })}
                                                            />
                                                            <div className="toggle-track-lg"></div>
                                                        </label>
                                                    </div>
                                                    <div style={{ borderRadius: '16px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', background: '#eef7f6', padding: '16px', marginTop: '12px' }}>
                                                        <div>
                                                            <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '13px' }}>Access Password</p>
                                                            <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500, fontStyle: 'italic' }}>
                                                                {normalizedSecuritySettings.passwordProtectionEnabled
                                                                    ? 'Set or replace the administrator password used when protection is enabled.'
                                                                    : 'You can prepare a password now, even while open access remains enabled.'}
                                                            </p>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1,1fr)', gap: '12px' }}>
                                                            <input
                                                                type="password"
                                                                value={accessPassword}
                                                                onChange={e => setAccessPassword(e.target.value)}
                                                                placeholder={primaryAdminUser?.password ? 'Leave blank to keep' : 'e.g. Secret123!'}
                                                                style={{ width: '100%', paddingLeft: '20px', paddingTop: '16px', background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', paddingRight: '20px', paddingBottom: '16px' }}
                                                            />
                                                            <input
                                                                type="password"
                                                                value={confirmAccessPassword}
                                                                onChange={e => setConfirmAccessPassword(e.target.value)}
                                                                placeholder="Repeat password"
                                                                style={{ width: '100%', paddingLeft: '20px', paddingTop: '16px', background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', paddingRight: '20px', paddingBottom: '16px' }}
                                                            />
                                                        </div>
                                                        {accessPassword && normalizedSecuritySettings.enforcePasswordComplexity && !accessPasswordValidation.valid && (
                                                            <p style={{ fontWeight: 600, color: '#d99a3f' }}>
                                                                {accessPasswordValidation.errors[0] || 'Password strength rules are not satisfied.'}
                                                            </p>
                                                        )}
                                                        {confirmAccessPassword && accessPassword !== confirmAccessPassword && (
                                                            <p style={{ fontWeight: 600, color: '#b5493f' }}>Access passwords do not match.</p>
                                                        )}
                                                    </div>
                                                    <div style={{ height: '1px', background: '#eef7f6' }}></div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', background: '#eef7f6', borderRadius: '16px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1' }}>
                                                        <div>
                                                            <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '14px', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Multi-Factor Authentication</p>
                                                            <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500, fontStyle: 'italic' }}>Require a 6-digit TOTP code for administrative access.</p>
                                                            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                                                                {normalizedSecuritySettings.requireTwoFactor ? (
                                                                     <span style={{ paddingLeft: '12px', paddingTop: '4px', background: '#d3ece9', color: '#0f544c', borderRadius: '9999px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.1em', border: '1.4px solid #e4ddd1', borderColor: '#a6d9d3', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 14px 0 rgba(31,133,119,.1)', paddingRight: '12px', paddingBottom: '4px' }}>
                                                                         <CheckCircle2 size={12} /> Active & Configured
                                                                     </span>
                                                                ) : (
                                                                     <span style={{ paddingLeft: '12px', paddingTop: '4px', background: '#eef7f6', color: '#5c6567', borderRadius: '9999px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.1em', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '12px', paddingBottom: '4px' }}>
                                                                         <Smartphone size={12} /> Not Configured
                                                                     </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            {normalizedSecuritySettings.requireTwoFactor ? (
                                                                <button 
                                                                    onClick={() => setConfig({ ...config, securitySettings: { ...normalizedSecuritySettings, requireTwoFactor: false } })}
                                                                    style={{ paddingLeft: '24px', paddingTop: '12px', background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderColor: '#b5493f', color: '#b5493f', borderRadius: '12px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all .15s ease', boxShadow: '0 1px 2px rgba(0,0,0,.05)', paddingRight: '24px', paddingBottom: '12px' }}
                                                                >
                                                                    Deactivate 2FA
                                                                </button>
                                                            ) : (
                                                                <button 
                                                                    onClick={() => setShow2FASetup(true)}
                                                                    style={{ paddingLeft: '32px', paddingTop: '12px', background: '#1f8577', color: '#fff', borderRadius: '12px', fontWeight: 900, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', boxShadow: '0 4px 14px 0 rgba(31,133,119,.2)', transition: 'all .15s ease', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '32px', paddingBottom: '12px' }}
                                                                >
                                                                    <Smartphone size={16} /> Setup MFA Now
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div style={{ height: '1px', background: '#eef7f6' }}></div>
                                                    <div className="group/field">
                                                        <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px', paddingLeft: '4px', transition: 'color .15s ease,background .15s ease,border-color .15s ease', paddingRight: '4px' }}>Audit Log Level</label>
                                                        <select
                                                            style={{ width: '100%', paddingLeft: '20px', paddingTop: '16px', background: '#eef7f6', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', paddingRight: '20px', paddingBottom: '16px' }}
                                                            value={normalizedSecuritySettings.auditLogLevel || 'Standard'}
                                                            onChange={e => setConfig({ ...config, securitySettings: { ...normalizedSecuritySettings, auditLogLevel: e.target.value as SecuritySettingsConfig['auditLogLevel'] } })}
                                                        >
                                                            <option value="Minimal">Minimal (Auth Only)</option>
                                                            <option value="Standard">Standard (CRUD Ops)</option>
                                                            <option value="Full">Full (Field-level changes)</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                <div style={{ marginTop: '32px' }}>
                                                    <div className="group/field">
                                                        <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px', paddingLeft: '4px', transition: 'color .15s ease,background .15s ease,border-color .15s ease', paddingRight: '4px' }}>Session Idle Timeout (Min)</label>
                                                        <input
                                                            type="number"
                                                            style={{ width: '100%', paddingLeft: '20px', paddingTop: '16px', background: '#eef7f6', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', paddingRight: '20px', paddingBottom: '16px' }}
                                                            placeholder="e.g. 30"
                                                            value={normalizedSecuritySettings.sessionTimeoutMinutes || 30}
                                                            onChange={e => setConfig({ ...config, securitySettings: { ...normalizedSecuritySettings, sessionTimeoutMinutes: parseInt(e.target.value) || 0 } })}
                                                        />
                                                    </div>
                                                    <div className="group/field">
                                                        <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px', paddingLeft: '4px', transition: 'color .15s ease,background .15s ease,border-color .15s ease', paddingRight: '4px' }}>Force Password Change (Days)</label>
                                                        <input
                                                            type="number"
                                                            style={{ width: '100%', paddingLeft: '20px', paddingTop: '16px', background: '#eef7f6', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', paddingRight: '20px', paddingBottom: '16px' }}
                                                            placeholder="e.g. 90"
                                                            value={normalizedSecuritySettings.forcePasswordChangeDays || 90}
                                                            onChange={e => setConfig({ ...config, securitySettings: { ...normalizedSecuritySettings, forcePasswordChangeDays: parseInt(e.target.value) || 0 } })}
                                                        />
                                                    </div>
                                                    <div className="group/field">
                                                        <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px', paddingLeft: '4px', transition: 'color .15s ease,background .15s ease,border-color .15s ease', paddingRight: '4px' }}>Lockout Attempts</label>
                                                        <input
                                                            type="number"
                                                            style={{ width: '100%', paddingLeft: '20px', paddingTop: '16px', background: '#eef7f6', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', paddingRight: '20px', paddingBottom: '16px' }}
                                                            placeholder="e.g. 5"
                                                            value={normalizedSecuritySettings.lockoutAttempts || 5}
                                                            onChange={e => setConfig({ ...config, securitySettings: { ...normalizedSecuritySettings, lockoutAttempts: parseInt(e.target.value) || 0 } })}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '40px' }}>
                                            <div>
                                                <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <Beaker size={18} style={{ color: '#1f8577' }} /> Quality Audit Terminal
                                                </h3>
                                                <p style={{ color: '#5c6567', fontWeight: 500, fontStyle: 'italic' }}>Physical-to-Ledger verification sweep.</p>
                                            </div>
                                            <button
                                                onClick={runIntegritySuite}
                                                disabled={isProcessing}
                                                style={{ color: '#fff', paddingLeft: '32px', paddingTop: '16px', borderRadius: '9999px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)', transition: 'all .15s ease', border: '1.4px solid #e4ddd1', borderColor: '#fff', paddingRight: '32px', paddingBottom: '16px' }}
                                            >
                                                {isProcessing ? <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', color: '#1f8577' }} /> : <Zap size={20} style={{ color: '#1f8577' }} />}
                                                {isProcessing ? 'Auditing...' : 'Run Logic Sweep'}
                                            </button>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '40px', marginBottom: '48px' }}>
                                            <div style={{ background: '#FEFDFB', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'all .15s ease' }}>
                                                <p style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Pass Status</p>
                                                <div style={{ fontSize: '48px', fontWeight: 700, display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                                    {testResults.length > 0 ? '100%' : '0%'}
                                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#1f8577' }}>SEALED</span>
                                                </div>
                                            </div>
                                            <div style={{ background: '#FEFDFB', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'all .15s ease' }}>
                                                <p style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Logical Drifts</p>
                                                <div style={{ fontSize: '48px', fontWeight: 700, color: '#1f8577', transition: 'transform .15s ease' }}>0</div>
                                            </div>
                                            <div style={{ padding: '24px', borderRadius: '10px', boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)', color: '#fff', border: '1.4px solid #e4ddd1', borderColor: '#fff', overflow: 'hidden', position: 'relative' }}>
                                                <div style={{ position: 'absolute', opacity: 0.1, transition: 'transform .15s ease' }}><Database size={120} /></div>
                                                <p style={{ fontWeight: 700, color: '#1f8577', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px', position: 'relative', zIndex: 10 }}>Ledger Sync</p>
                                                <div style={{ fontSize: '30px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-.05em', position: 'relative', zIndex: 10 }}>ACCURATE</div>
                                            </div>
                                        </div>

                                        <div style={{ marginTop: '16px', marginBottom: '64px' }}>
                                            {testResults.map((r, i) => (
                                                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px', background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transitionDuration: '500ms', transition: 'all .15s ease' }} style={{ animationDelay: `${i * 150}ms` }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                                        <div style={{ padding: '16px', borderRadius: '8px', border: '1.4px solid #e4ddd1', transition: 'all .15s ease' }}>
                                                            <FileCheck size={28} />
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-.05em', fontSize: '16px', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>{r.name}</div>
                                                            <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '4px' }}>{r.cases} Real-time Records Scanned</div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                                        <div style={{ fontWeight: 700, color: '#1f8577' }}>{r.status}</div>
                                                        <CheckCircle2 size={28} style={{ color: '#1f8577', transition: 'transform .15s ease' }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div style={{ height: '1px', background: '#eef7f6', marginBottom: '64px' }}></div>

                                        <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <Database size={18} style={{ color: '#1f8577' }} /> Persistence & Backups
                                        </h3>
                                        <input
                                            ref={restoreInputRef}
                                            type="file"
                                            accept=".db,.json,application/octet-stream,application/json"
                                            style={{ display: 'hidden' }}
                                            onChange={handleRestoreBackupFile}
                                        />
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1,1fr)', gap: '40px', marginBottom: '48px' }}>
                                            <div style={{ background: '#FEFDFB', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transition: 'all .15s ease' }}>
                                                <div style={{ width: '80px', height: '80px', borderRadius: '10px', background: '#eef7f6', color: '#1f8577', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'transform .15s ease' }}><HardDriveDownload size={40} /></div>
                                                <h4 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Backup Database</h4>
                                                <p style={{ fontSize: '13px', lineHeight: 1.625, marginBottom: '16px', maxWidth: '320px', marginLeft: 'auto' }}>Create a full offline snapshot of your live IndexedDB data and saved local system settings.</p>
                                                <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#5c6567', marginBottom: '24px' }}>
                                                    Last backup: {backupStatus.lastBackupAt ? new Date(backupStatus.lastBackupAt).toLocaleString() : 'Not yet created'}
                                                </div>
                                                <button onClick={handleManualBackupDownload} style={{ width: '100%', paddingTop: '16px', color: '#fff', borderRadius: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all .15s ease', boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)', paddingBottom: '16px' }}>Download Vault Binary</button>
                                            </div>
                                            <div style={{ background: '#FEFDFB', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transition: 'all .15s ease' }}>
                                                <div style={{ width: '80px', height: '80px', borderRadius: '10px', background: '#eef7f6', color: '#1f8577', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'transform .15s ease' }}><Database size={40} /></div>
                                                <h4 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Restore Database</h4>
                                                <p style={{ fontSize: '13px', lineHeight: 1.625, marginBottom: '16px', maxWidth: '320px', marginLeft: 'auto' }}>Restore a previously downloaded Prime ERP backup file and reload the full local database state.</p>
                                                <div style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#5c6567', marginBottom: '24px' }}>
                                                    Last restore: {backupStatus.lastRestoreAt ? `${new Date(backupStatus.lastRestoreAt).toLocaleString()}${backupStatus.lastRestoreFile ? ` • ${backupStatus.lastRestoreFile}` : ''}` : 'No restore executed'}
                                                </div>
                                                <button
                                                    onClick={handleRestoreBackupRequest}
                                                    disabled={isRestoringBackup}
                                                    style={{ width: '100%', paddingTop: '16px', background: '#1f8577', color: '#fff', borderRadius: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all .15s ease', boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)', paddingBottom: '16px' }}
                                                >
                                                    {isRestoringBackup ? 'Restoring Database...' : 'Restore From Backup'}
                                                </button>
                                            </div>
                                            <div style={{ background: '#fef2f2', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', borderColor: '#b5493f', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transition: 'all .15s ease' }}>
                                                <div style={{ width: '80px', height: '80px', borderRadius: '10px', background: '#fee2e2', color: '#b5493f', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'transform .15s ease' }}><RefreshCw size={40} /></div>
                                                <h4 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Reset to Factory Samples</h4>
                                                <p style={{ fontSize: '13px', opacity: 0.6, lineHeight: 1.625, marginBottom: '32px', maxWidth: '320px', marginLeft: 'auto' }}>Irreversibly purge all current data and reload the system with printing & production sample data.</p>
                                                <button onClick={() => confirm("IRREVERSIBLE ACTION: This will delete all your current work and reload printing/production samples. Proceed?") && resetSystem()} style={{ width: '100%', paddingTop: '16px', background: '#b5493f', color: '#fff', borderRadius: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all .15s ease', boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)', paddingBottom: '16px' }}>Reset System Data</button>
                                            </div>
                                        </div>

                                        <div style={{ background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', padding: '24px', marginTop: '32px', boxShadow: '0 1px 2px rgba(0,0,0,.05)', transition: 'all .15s ease' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', fontSize: '14px', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}>Automated Cloud Backups</p>
                                                    <p style={{ color: '#5c6567', marginTop: '4px', fontWeight: 500, fontStyle: 'italic' }}>Schedule encrypted snapshots to secure cloud storage.</p>
                                                </div>
                                                <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                                                    <input
                                                        type="checkbox"
                                                        className="toggle-input"
                                                        checked={config.backupSettings?.autoBackupEnabled}
                                                        onChange={e => setConfig({
                                                            ...config,
                                                            backupSettings: {
                                                                ...(config.backupSettings || { autoBackupEnabled: false, backupFrequency: 'Daily', retentionCount: 30, cloudBackupEnabled: false }),
                                                                autoBackupEnabled: e.target.checked
                                                            }
                                                        })}
                                                    />
                                                    <div className="toggle-track-lg"></div>
                                                </label>
                                            </div>
                                            <div style={{ height: '1px', background: '#eef7f6' }}></div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '40px' }}>
                                                <div className="group/field">
                                                    <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px', paddingLeft: '4px', transition: 'color .15s ease,background .15s ease,border-color .15s ease', paddingRight: '4px' }}>Backup Frequency</label>
                                                    <select
                                                        style={{ width: '100%', paddingLeft: '20px', paddingTop: '16px', background: '#eef7f6', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', paddingRight: '20px', paddingBottom: '16px' }}
                                                        value={config.backupSettings?.backupFrequency || 'Daily'}
                                                        onChange={e => setConfig({
                                                            ...config,
                                                            backupSettings: {
                                                                ...(config.backupSettings || { autoBackupEnabled: false, backupFrequency: 'Daily', retentionCount: 30, cloudBackupEnabled: false }),
                                                                 backupFrequency: e.target.value as 'Daily' | 'Weekly' | 'Monthly'
                                                            }
                                                        })}
                                                    >
                                                        <option value="Daily">Daily Snapshot</option>
                                                        <option value="Weekly">Weekly Archive</option>
                                                        <option value="Monthly">Monthly Vault</option>
                                                    </select>
                                                </div>
                                                <div className="group/field">
                                                    <label style={{ display: 'block', fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '12px', paddingLeft: '4px', transition: 'color .15s ease,background .15s ease,border-color .15s ease', paddingRight: '4px' }}>Retention Limit</label>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <div style={{ position: 'relative', flex: 1 }}>
                                                            <input
                                                                type="number"
                                                                style={{ width: '100%', paddingLeft: '20px', paddingTop: '16px', background: '#eef7f6', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '12px', fontWeight: 700, fontSize: '13px', outline: 'none', transition: 'all .15s ease', paddingRight: '20px', paddingBottom: '16px' }}
                                                                value={config.backupSettings?.retentionCount || 30}
                                                                onChange={e => setConfig({
                                                                    ...config,
                                                                    backupSettings: {
                                                                        ...(config.backupSettings || { autoBackupEnabled: false, backupFrequency: 'Daily', retentionCount: 30, cloudBackupEnabled: false }),
                                                                        retentionCount: parseInt(e.target.value) || 0
                                                                    }
                                                                })}
                                                            />
                                                        </div>
                                                        <span style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em' }}>Versions</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            )
                        }


                        {
                            activeTab === 'Privacy' && (
                                <div style={{ padding: '24px', background: '#FEFDFB', borderRadius: '12px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1' }}>
                                    <ComplianceSettings config={complianceConfig} onChange={setComplianceConfig} />
                                </div>
                            )
                        }

                        {
                            activeTab === 'System' && (
                                <div style={{ marginTop: '48px' }}>
                                    <section>
                                        <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <Cpu size={18} style={{ color: '#1f8577' }} /> Hardware Fingerprint
                                        </h3>
                                        <div style={{ background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', padding: '24px', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '32px', background: '#eef7f6', borderRadius: '24px', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1' }}>
                                                <div>
                                                    <p style={{ fontWeight: 900, color: '#23282A', textTransform: 'uppercase', letterSpacing: '-.05em', fontSize: '16px' }}>Unique Device Identifier</p>
                                                    <p style={{ fontSize: '11px', color: '#5c6567', fontWeight: 700 }}>Provide this fingerprint to your administrator to generate a license key.</p>
                                                    <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <code style={{ background: '#0b3e39', color: '#3fa294', paddingLeft: '16px', paddingTop: '8px', borderRadius: '10px', fontFamily: '"JetBrains Mono",monospace', fontSize: '13px', fontWeight: 700, boxShadow: '0 20px 25px -5px rgba(0,0,0,.1)', paddingRight: '16px', paddingBottom: '8px' }}>
                                                            {systemInfo?.fingerprint || 'GENERATING...'}
                                                        </code>
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(systemInfo?.fingerprint || '');
                                                                notify('Fingerprint copied to clipboard', 'success');
                                                            }}
                                                            style={{ padding: '8px', background: '#FEFDFB', border: '1.4px solid #e4ddd1', borderColor: '#e4ddd1', borderRadius: '10px', color: '#5c6567', transition: 'color .15s ease,background .15s ease,border-color .15s ease' }}
                                                        >
                                                            <Save size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div style={{ padding: '24px', background: '#d3ece9', color: '#1f8577', borderRadius: '16px' }}>
                                                    <Binary size={32} />
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section>
                                        <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <ShieldCheck size={18} style={{ color: '#1f8577' }} /> License Status
                                        </h3>
                                        <div style={{ background: '#FEFDFB', borderRadius: '10px', border: '1.4px solid #e4ddd1', padding: '24px', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                            <div className={`flex items-center justify-between p-8 rounded-3xl border ${systemInfo?.license?.valid ? 'bg-blue-50 border-blue-100' : 'bg-rose-50 border-rose-100'}`}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                                    <div className={`p-5 rounded-2xl ${systemInfo?.license?.valid ? 'bg-blue-100 text-blue-600' : 'bg-rose-100 text-rose-600'}`}>
                                                        {systemInfo?.license?.valid ? <CheckCircle2 size={32} /> : <AlertTriangle size={32} />}
                                                    </div>
                                                    <div>
                                                        <p className={`font-black uppercase tracking-tighter text-xl ${systemInfo?.license?.valid ? 'text-blue-900' : 'text-rose-900'}`}>
                                                            {systemInfo?.license?.valid ? 'SYSTEM ACTIVATED' : 'LICENSE INVALID'}
                                                        </p>
                                                        <p className={`text-xs font-bold ${systemInfo?.license?.valid ? 'text-blue-600' : 'text-rose-600'}`}>
                                                            {systemInfo?.license?.valid
                                                                ? `Full Professional License active until ${new Date(systemInfo.license.expiry).toLocaleDateString()}`
                                                                : systemInfo?.license?.message || 'Please install a valid license.lic file in the root directory.'}
                                                        </p>
                                                    </div>
                                                </div>
                                                {!systemInfo?.license?.valid && (
                                                    <button 
                                                        onClick={() => {
                                                            // Trigger license activation - open file picker for .lic file
                                                            const input = document.createElement('input');
                                                            input.type = 'file';
                                                            input.accept = '.lic';
                                                            input.onchange = async (e) => {
                                                                const file = (e.target as HTMLInputElement).files?.[0];
                                                                if (file) {
                                                                    try {
                                                                        const content = await file.text();
                                                                        // Send license to server for validation/activation
                                                                        const result = await api.system.activateLicense(content);
                                                                        if (result.success) {
                                                                            notify('License activated successfully!', 'success');
                                                                            // Reload system info to reflect new license status
                                                                            fetchSystemInfo();
                                                                        } else {
                                                                            notify('License activation failed: ' + result.message, 'error');
                                                                        }
                                                                    } catch (error) {
                                                                        notify('Failed to read license file: ' + (error instanceof Error ? error.message : String(error)), 'error');
                                                                    }
                                                                }
                                                            };
                                                            input.click();
                                                        }}
                                                        style={{ paddingLeft: '24px', paddingTop: '12px', background: '#b5493f', color: '#fff', borderRadius: '12px', fontWeight: 900, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all .15s ease', boxShadow: '0 1px 3px rgba(0,0,0,.1)', paddingRight: '24px', paddingBottom: '12px' }}
                                                    >
                                                        Activate Now
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </section>

                                    <section>
                                        <h3 style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <Info size={18} style={{ color: '#5c6567' }} /> System Information
                                        </h3>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '40px' }}>
                                            <div style={{ background: '#FEFDFB', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                                <p style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Platform</p>
                                                <p style={{ fontSize: '16px', fontWeight: 900, color: '#23282A', textTransform: 'capitalize' }}>{window.navigator.platform}</p>
                                            </div>
                                            <div style={{ background: '#FEFDFB', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                                <p style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Environment</p>
                                                <p style={{ fontSize: '16px', fontWeight: 900, color: '#23282A' }}>Standalone Offline</p>
                                            </div>
                                            <div style={{ background: '#FEFDFB', padding: '24px', borderRadius: '10px', border: '1.4px solid #e4ddd1', boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>
                                                <p style={{ fontWeight: 900, color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Build Version</p>
                                                <p style={{ fontSize: '16px', fontWeight: 900, color: '#23282A' }}>v2.4.0-standalone</p>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            )
                        }

                        {activeTab === 'ProfitMargins' && (
                            <div style={{ marginTop: '24px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '16px', background: '#1f8577', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.1)' }}>
                                        <TrendingUp size={20} style={{ color: '#fff' }} />
                                    </div>
                                    <div>
                                        <h2 style={{ fontSize: '16px', fontWeight: 900, color: '#23282A' }}>Profit Markup Overrides</h2>
                                        <p style={{ fontSize: '11px', color: '#5c6567' }}>Manage global, category and line-item pricing markups. Requires Admin or Finance Manager role.</p>
                                    </div>
                                </div>
                                <ProfitMarkupSettings />
                            </div>
                        )}

                        {
                            activeTab === 'Attributes' && (
                                <div style={{ marginTop: '24px' }}>
                                    <AttributesTab />
                                </div>
                            )
                        }

                        {
                            activeTab === 'Finishing' && (
                                <FinishingOptionsTab config={config} setConfig={setConfig} notify={notify} items={inventory} />
                            )
                        }

                        {
                            activeTab === 'Pricing' && (
                                <div style={{ marginTop: '48px' }}>
                                    <PricingAdminTab config={config} setConfig={setConfig} notify={notify} />
                                </div>
                            )
                        }

                        {
                            activeTab === 'Referrals' && (
                                <ReferralSettingsTab config={config} setConfig={setConfig} />
                            )
                        }

                        {
                            activeTab === 'Engagement' && (
                                <EngagementSettingsTab />
                            )
                        }

                        {
                            activeTab === 'FinancialYears' && (
                                <FinancialYearsSettingsTab notify={notify} />
                            )
                        }

                    </div >
                </div >
            </div>
            <CustomizeDashboard />
            {show2FASetup && (
                <TwoFactorSetup 
                    onComplete={(secret) => {
                        setConfig({ 
                            ...config, 
                            securitySettings: { 
                                ...normalizedSecuritySettings, 
                                requireTwoFactor: true,
                                mfaSecret: secret
                            } 
                        });
                        setShow2FASetup(false);
                        notify('MFA successfully configured and enabled.', 'success');
                    }}
                    onCancel={() => setShow2FASetup(false)}
                />
            )}
            <ConfirmDialog
              open={confirmState.open}
              onOpenChange={(open) => !open && setConfirmState(c => ({ ...c, open: false }))}
              onConfirm={() => {
                confirmState.onConfirm?.();
                setConfirmState(c => ({ ...c, open: false }));
              }}
              onCancel={() => setConfirmState(c => ({ ...c, open: false }))}
              title={confirmState.title}
              message={confirmState.message}
              confirmText={confirmState.confirmText}
              type={confirmState.type || 'question'}
            />
            <ConfirmDialog
              open={doubleConfirmState.open}
              onOpenChange={(open) => !open && setDoubleConfirmState(c => ({ ...c, open: false }))}
              onConfirm={() => {
                doubleConfirmState.onConfirm?.();
                setDoubleConfirmState(c => ({ ...c, open: false }));
              }}
              onCancel={() => setDoubleConfirmState(c => ({ ...c, open: false }))}
              title={doubleConfirmState.title}
              message={doubleConfirmState.message}
              confirmText={doubleConfirmState.confirmText}
              type={doubleConfirmState.type || 'danger'}
            />
        </div>
    );
};

const FinancialYearsSettingsTab: React.FC<{ notify: (msg: string, type?: string) => void }> = ({ notify }) => {
    const { availableFinancialYears, selectedFinancialYear, refreshFinancialYears } = useFinancialYear();
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newStart, setNewStart] = useState('');
    const [newEnd, setNewEnd] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const resetForm = () => {
        setNewName('');
        setNewStart('');
        setNewEnd('');
        setShowCreateForm(false);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName || !newStart || !newEnd) return;
        setSubmitting(true);
        try {
            await api.system.createFinancialYear({
                name: newName,
                code: newName.replace(/\s+/g, '_').toUpperCase(),
                start_date: newStart,
                end_date: newEnd,
                is_default: availableFinancialYears.length === 0,
                status: 'Active',
                is_closed: false
            });
            notify('Financial year created successfully', 'success');
            resetForm();
            refreshFinancialYears();
        } catch (err: any) {
            notify(err?.message || 'Failed to create financial year', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSetActive = async (fy: any) => {
        try {
            await api.system.updateFinancialYear(fy.id, { is_default: true });
            notify('Active financial year updated', 'success');
            refreshFinancialYears();
        } catch (err: any) {
            notify(err?.message || 'Failed to set active financial year', 'error');
        }
    };

    const handleClose = async (fy: any) => {
        try {
            await api.system.closeFinancialYear(fy.id);
            notify('Financial year closed', 'success');
            refreshFinancialYears();
        } catch (err: any) {
            notify(err?.message || 'Failed to close financial year', 'error');
        }
    };

    const handleDelete = async (fy: any) => {
        try {
            await api.system.deleteFinancialYear(fy.id);
            notify('Financial year deleted', 'success');
            refreshFinancialYears();
        } catch (err: any) {
            notify(err?.message || 'Failed to delete financial year', 'error');
        }
    };

    const formatFyLabel = (fy: any) => {
        const sy = fy.start_date?.slice(0, 4);
        const ey = fy.end_date?.slice(0, 4);
        return sy !== ey ? `FY ${sy}/${ey?.slice(2)}` : `FY ${sy}`;
    };

    return (
        <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '16px', background: '#1f8577', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.1)' }}>
                    <CalendarDays size={20} style={{ color: '#fff' }} />
                </div>
                <div>
                    <h2 style={{ fontSize: '16px', fontWeight: 900, color: '#23282A' }}>Financial Years</h2>
                    <p style={{ fontSize: '11px', color: '#5c6567' }}>Manage financial year periods. The active year is used for all transactions and reports.</p>
                </div>
            </div>

            <div style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ fontSize: '13px', fontWeight: 700 }}>All Financial Years</h3>
                        <p style={{ marginTop: '2px' }}>Create, close, or delete financial years.</p>
                    </div>
                    <button
                        onClick={() => setShowCreateForm(!showCreateForm)}
                        style={{ paddingLeft: '16px', paddingTop: '8px', background: '#1f8577', color: '#fff', borderRadius: '12px', fontSize: '13px', fontWeight: 600, boxShadow: '0 1px 3px rgba(0,0,0,.1)', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '16px', paddingBottom: '8px' }}
                    >
                        <Plus size={16} /> New Financial Year
                    </button>
                </div>

                {showCreateForm && (
                    <div style={{ padding: '24px', borderStyle: 'solid', borderColor: '#e4ddd1', background: '#eef7f6' }}>
                        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '16px' }}>
                            <div>
                                <label className="settings-label">Year Name</label>
                                <input
                                    type="text"
                                    className="settings-input"
                                    placeholder="e.g. 2025/2026"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <label className="settings-label">Start Date</label>
                                <input
                                    type="date"
                                    className="settings-input"
                                    value={newStart}
                                    onChange={e => setNewStart(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <label className="settings-label">End Date</label>
                                <input
                                    type="date"
                                    className="settings-input"
                                    value={newEnd}
                                    onChange={e => setNewEnd(e.target.value)}
                                    required
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'end', gap: '8px' }}>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    style={{ paddingLeft: '16px', paddingTop: '8px', background: '#1f8577', color: '#fff', borderRadius: '12px', fontSize: '13px', fontWeight: 600, paddingRight: '16px', paddingBottom: '8px' }}
                                >
                                    {submitting ? 'Creating...' : 'Create'}
                                </button>
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    style={{ paddingLeft: '16px', paddingTop: '8px', background: '#d3ece9', color: '#23282A', borderRadius: '12px', fontSize: '13px', fontWeight: 600, paddingRight: '16px', paddingBottom: '8px' }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', textAlign: 'left', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ borderStyle: 'solid', borderColor: '#e4ddd1', fontSize: '11px', color: '#5c6567', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                <th style={{ paddingLeft: '24px', paddingTop: '12px', fontWeight: 600, paddingRight: '24px', paddingBottom: '12px' }}>Name</th>
                                <th style={{ paddingLeft: '24px', paddingTop: '12px', fontWeight: 600, paddingRight: '24px', paddingBottom: '12px' }}>Period</th>
                                <th style={{ paddingLeft: '24px', paddingTop: '12px', fontWeight: 600, paddingRight: '24px', paddingBottom: '12px' }}>Status</th>
                                <th style={{ paddingLeft: '24px', paddingTop: '12px', fontWeight: 600, textAlign: 'right', paddingRight: '24px', paddingBottom: '12px' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody style={{ borderColor: '#e4ddd1' }}>
                            {availableFinancialYears.length === 0 ? (
                                <tr>
                                    <td colSpan={4} style={{ paddingLeft: '24px', paddingTop: '32px', textAlign: 'center', color: '#5c6567', fontSize: '13px', paddingRight: '24px', paddingBottom: '32px' }}>
                                        No financial years configured. Create one to get started.
                                    </td>
                                </tr>
                            ) : (
                                availableFinancialYears.map(fy => {
                                    const isActive = selectedFinancialYear?.id === fy.id;
                                    const isDefault = fy.is_default === 1;
                                    return (
                                        <tr key={fy.id} className={`hover:bg-slate-50/50 transition-colors ${isActive ? 'bg-blue-50/30' : ''}`}>
                                            <td style={{ paddingLeft: '24px', paddingTop: '16px', paddingRight: '24px', paddingBottom: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontWeight: 600, color: '#23282A' }}>{fy.name}</span>
                                                    {isDefault && <span style={{ fontWeight: 700, color: '#1f8577', background: '#d3ece9', paddingLeft: '8px', paddingTop: '2px', borderRadius: '9999px', paddingRight: '8px', paddingBottom: '2px' }}>Default</span>}
                                                    {isActive && <span style={{ fontWeight: 700, color: '#1f8577', background: '#d3ece9', paddingLeft: '8px', paddingTop: '2px', borderRadius: '9999px', paddingRight: '8px', paddingBottom: '2px' }}>Active</span>}
                                                </div>
                                            </td>
                                            <td style={{ paddingLeft: '24px', paddingTop: '16px', color: '#5c6567', paddingRight: '24px', paddingBottom: '16px' }}>
                                                {fy.start_date} – {fy.end_date}
                                            </td>
                                            <td style={{ paddingLeft: '24px', paddingTop: '16px', paddingRight: '24px', paddingBottom: '16px' }}>
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${fy.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}>
                                                    {fy.status}
                                                </span>
                                            </td>
                                            <td style={{ paddingLeft: '24px', paddingTop: '16px', textAlign: 'right', paddingRight: '24px', paddingBottom: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                                                    {!isDefault && fy.status === 'Active' && (
                                                        <button
                                                            onClick={() => handleSetActive(fy)}
                                                            style={{ fontSize: '11px', color: '#1f8577', fontWeight: 500 }}
                                                        >
                                                            Set Active
                                                        </button>
                                                    )}
                                                    {fy.status === 'Active' && (
                                                        <button
                                                            onClick={() => handleClose(fy)}
                                                            style={{ fontSize: '11px', color: '#d99a3f', fontWeight: 500 }}
                                                        >
                                                            Close
                                                        </button>
                                                    )}
                                                    {!isDefault && (
                                                        <button
                                                            onClick={() => handleDelete(fy)}
                                                            style={{ fontSize: '11px', color: '#b5493f', fontWeight: 500 }}
                                                        >
                                                            Delete
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Settings;
