import { create } from 'zustand';
import { logger } from '@/services/logger';
import { VATConfig, VatTransaction, VatReturn } from '../types';
import { dbService } from '../services/db';
import { generateNextId } from '../utils/helpers';

interface VatState {
    config: VATConfig;
    transactions: VatTransaction[];
    returns: VatReturn[];
    isLoading: boolean;

    fetchVatData: () => Promise<void>;
    updateConfig: (config: VATConfig) => Promise<void>;
    addTransaction: (transaction: VatTransaction) => Promise<void>;
    generateReturn: (periodStart: string, periodEnd: string) => Promise<VatReturn>;
    fileReturn: (returnId: string, paymentDate?: string) => Promise<void>;
}

export const useVatStore = create<VatState>((set, get) => ({
    config: {
        vatEnabled: true,
        vatNumber: 'VAT-PENDING',
        defaultVatRate: 16.5,
        filingFrequency: 'Monthly',
        taxAuthority: 'MRA',
        cashAccounting: false,
    },
    transactions: [],
    returns: [],
    isLoading: false,

    fetchVatData: async () => {
        set({ isLoading: true });
        try {
            const [transactions, returns] = await Promise.all([
                dbService.getAll<VatTransaction>('vatTransactions'),
                dbService.getAll<VatReturn>('vatReturns'),
            ]);
            set({
                transactions: transactions || [],
                returns: returns || [],
            });
        } catch (error) {
            logger.error('Failed to fetch VAT data:', error);
        } finally {
            set({ isLoading: false });
        }
    },

    updateConfig: async (config: VATConfig) => {
        set({ config });
        const storedConfig = localStorage.getItem('nexus_company_config');
        let newCompanyConfig: Record<string, unknown> = {};
        if (storedConfig) {
            try {
                newCompanyConfig = JSON.parse(storedConfig);
            } catch {}
        }
        (newCompanyConfig as Record<string, unknown>).vat = config;
        await dbService.saveSetting('companyConfig', newCompanyConfig);
    },

    addTransaction: async (transaction: VatTransaction) => {
        await dbService.put('vatTransactions', transaction);
        set(state => ({ transactions: [...state.transactions, transaction] }));
    },

    generateReturn: async (periodStart: string, periodEnd: string) => {
        const { transactions } = get();

        // Filter unfiled transactions within period
        const periodTransactions = transactions.filter(t =>
            !t.isFiled &&
            t.date >= periodStart &&
            t.date <= periodEnd
        );

        const totalInput = periodTransactions
            .filter(t => t.type === 'Input')
            .reduce((sum, t) => sum + t.amount, 0);

        const totalOutput = periodTransactions
            .filter(t => t.type === 'Output')
            .reduce((sum, t) => sum + t.amount, 0);

        const newReturn: VatReturn = {
            id: generateNextId('VATR', get().returns),
            periodStart,
            periodEnd,
            totalInputTax: totalInput,
            totalOutputTax: totalOutput,
            netPayable: totalOutput - totalInput,
            status: 'Draft',
            transactions: periodTransactions.map(t => t.id)
        };

        const db = await dbService.initDB();
        await db.put('vatReturns', newReturn);
        set(state => ({ returns: [...state.returns, newReturn] }));

        return newReturn;
    },

    fileReturn: async (returnId: string, paymentDate?: string) => {
        const { returns, transactions } = get();
        const vatReturn = returns.find(r => r.id === returnId);
        if (!vatReturn) return;

        const updatedReturn: VatReturn = {
            ...vatReturn,
            status: paymentDate ? 'Paid' : 'Filed',
            filingDate: new Date().toISOString(),
            paymentDate
        };

        // Mark transactions as filed
        const db = await dbService.initDB();
        const tx = db.transaction(['vatReturns', 'vatTransactions'], 'readwrite');

        await tx.objectStore('vatReturns').put(updatedReturn);

        for (const txId of vatReturn.transactions) {
            const t = transactions.find(tr => tr.id === txId);
            if (t) {
                const updatedT = { ...t, isFiled: true, returnId };
                await tx.objectStore('vatTransactions').put(updatedT);
            }
        }

        await tx.done;

        // Refresh state
        get().fetchVatData();
    }
}));
