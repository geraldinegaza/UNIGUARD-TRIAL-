import React, { useState, useMemo } from 'react';
import { User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import {
  HelpCircle,
  Plus,
  Search,
  Check,
  X,
  Edit3,
  Trash2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  FileQuestion,
  Layers,
  Sparkles
} from 'lucide-react';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

const DEFAULT_FAQ_CATEGORIES = [
  'All',
  'Disaster Alerts & Triage',
  'Relief & Shelters',
  'Offline & Sync',
  'Emergency Hotlines',
  'General Protocols',
];

interface LdrrmcFaqsViewProps {
  currentUser: User;
}

export const LdrrmcFaqsView: React.FC<LdrrmcFaqsViewProps> = ({ currentUser }) => {
  const isBarangay = currentUser?.role === 'barangay';

  // FAQs from the faqs table
  const store = useRepo();
  const faqs: FaqItem[] = useMemo(
    () => store.faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer, category: f.category })),
    [store.faqs]
  );
  const FAQ_CATEGORIES = useMemo(
    () => Array.from(new Set([...DEFAULT_FAQ_CATEGORIES, ...faqs.map((f) => f.category)])),
    [faqs]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FaqItem | null>(null);
  const [formQuestion, setFormQuestion] = useState('');
  const [formAnswer, setFormAnswer] = useState('');
  const [formCategory, setFormCategory] = useState('Disaster Alerts & Triage');

  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const flash = (message: string, ms = 4000) => {
    setActionNotice(message);
    setTimeout(() => setActionNotice(null), ms);
  };

  const filteredFaqs = useMemo(() => {
    return faqs.filter((f) => {
      if (selectedCategory !== 'All' && f.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesQ = f.question.toLowerCase().includes(q);
        const matchesA = f.answer.toLowerCase().includes(q);
        const matchesC = f.category.toLowerCase().includes(q);
        if (!matchesQ && !matchesA && !matchesC) return false;
      }
      return true;
    });
  }, [faqs, selectedCategory, searchQuery]);

  // Open Add Modal
  const handleOpenAdd = () => {
    setEditingFaq(null);
    setFormQuestion('');
    setFormAnswer('');
    setFormCategory('Disaster Alerts & Triage');
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (faq: FaqItem) => {
    setEditingFaq(faq);
    setFormQuestion(faq.question);
    setFormAnswer(faq.answer);
    setFormCategory(faq.category);
    setIsModalOpen(true);
  };

  // Save FAQ Form
  const handleSaveFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formQuestion.trim() || !formAnswer.trim()) return;

    const input = { question: formQuestion.trim(), answer: formAnswer.trim(), category: formCategory };
    try {
      if (editingFaq) {
        await repo.updateFaq(editingFaq.id, input);
        flash(`Updated FAQ entry: "${input.question.slice(0, 35)}..."`);
      } else {
        await repo.createFaq(input);
        flash(`Published new FAQ: "${input.question.slice(0, 35)}..."`);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      flash(err.message || 'Could not save the FAQ.');
    }
  };

  // Delete FAQ
  const handleDeleteFaq = async (id: string) => {
    if (!window.confirm('Delete this FAQ? It will be removed for every resident.')) return;
    try {
      await repo.deleteFaq(id);
      flash('FAQ entry removed', 3000);
    } catch (err: any) {
      flash(err.message || 'Could not delete the FAQ.');
    }
  };

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* 1. Header Section: FAQ Management + Subtitle + Add FAQ Button */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            FAQ Management
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
            Add, edit or remove entries. Citizens see changes immediately — no app release required.
          </p>
        </div>

        {/* Top Right Action Button: + Add FAQ */}
        <button
          onClick={handleOpenAdd}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-full shadow-xs transition-colors cursor-pointer shrink-0 self-start sm:self-auto ${
            isBarangay ? 'bg-[#052659] hover:bg-[#031c42] text-white' : 'bg-[#18181b] hover:bg-neutral-800 text-white'
          }`}
        >
          <Plus className="w-4 h-4" />
          <span>Add FAQ</span>
        </button>
      </div>

      {/* Action Flash Notification */}
      {actionNotice && (
        <div className={`p-3.5 rounded-[20px] text-xs font-medium flex items-center justify-between animate-in fade-in ${
          isBarangay
            ? 'bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#052659]'
            : 'bg-neutral-100/90 border border-neutral-200/80 text-neutral-800'
        }`}>
          <div className="flex items-center gap-2">
            <Check className={`w-4 h-4 shrink-0 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
            <span>{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className={`cursor-pointer ${isBarangay ? 'text-[#5482B4] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search and Category Filter Bar */}
      {faqs.length > 0 && (
        <div className={`rounded-[24px] p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 ${
          isBarangay ? 'bg-white border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'bg-white border border-neutral-200/70'
        }`}>
          <div className="relative flex-1">
            <Search className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${
              isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'
            }`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search FAQs by question, answer, or topic..."
              className={`w-full pl-10 pr-9 py-2.5 text-xs font-medium rounded-full focus:outline-hidden shadow-2xs transition-all ${
                isBarangay
                  ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] placeholder-[#7EA0C5] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                  : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className={`absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer ${
                  isBarangay ? 'text-[#5482B4] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {FAQ_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  selectedCategory === cat
                    ? isBarangay
                      ? 'bg-[#052659] text-white shadow-2xs'
                      : 'bg-[#2A2A2A] text-white shadow-2xs'
                    : isBarangay
                      ? 'bg-[#C2E8FF]/25 hover:bg-[#C2E8FF]/40 text-[#052659] border border-[#7EA0C5]/40'
                      : 'bg-neutral-100 hover:bg-neutral-200/80 text-neutral-700 border border-neutral-200/60'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. Section Card: All FAQs */}
      <div className={`bg-white rounded-[24px] shadow-xs overflow-hidden ${
        isBarangay ? 'border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'border border-neutral-200/70'
      }`}>
        {/* Card Header Bar */}
        <div className={`px-6 py-4.5 flex items-center justify-between ${
          isBarangay ? 'bg-[#C2E8FF]/10 border-b border-[#7EA0C5]/20' : 'bg-neutral-50/50 border-b border-neutral-100'
        }`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            All FAQs
          </h2>

          <span className={`px-3 py-1 rounded-full text-xs font-mono font-medium shadow-2xs ${
            isBarangay
              ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
              : 'bg-neutral-100 text-neutral-800 border border-neutral-200/80'
          }`}>
            {faqs.length} {faqs.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {/* Card Body: Empty State or FAQ List */}
        {filteredFaqs.length === 0 ? (
          /* Empty State */
          <div className="p-16 text-center space-y-3">
            <div className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center shadow-2xs ${
              isBarangay ? 'bg-[#C2E8FF]/30 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
            }`}>
              <HelpCircle className="w-6 h-6" />
            </div>
            <h3 className={`text-sm font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>
              No FAQs yet
            </h3>
            <p className={`text-xs max-w-sm mx-auto ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
              Add the first one.
            </p>
            <div className="pt-2">
              <button
                onClick={handleOpenAdd}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-full shadow-xs transition-colors cursor-pointer ${
                  isBarangay ? 'bg-[#052659] hover:bg-[#031c42] text-white' : 'bg-[#18181b] hover:bg-neutral-800 text-white'
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>Create FAQ Entry</span>
              </button>
            </div>
          </div>
        ) : (
          /* FAQs Accordion List matching reference list styling */
          <div className={`divide-y ${isBarangay ? 'divide-[#7EA0C5]/15' : 'divide-neutral-100'}`}>
            {filteredFaqs.map((faq) => {
              const isExpanded = expandedFaqId === faq.id;

              return (
                <div key={faq.id} className={`p-5 sm:p-6 transition-colors ${
                  isBarangay ? 'hover:bg-[#C2E8FF]/10' : 'hover:bg-neutral-50/50'
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 cursor-pointer" onClick={() => setExpandedFaqId(isExpanded ? null : faq.id)}>
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                          isBarangay
                            ? 'bg-[#C2E8FF]/50 text-[#052659] border border-[#7EA0C5]/40'
                            : 'bg-neutral-100 text-neutral-700 border border-neutral-200/80'
                        }`}>
                          {faq.category}
                        </span>
                        <span className={`text-[10px] font-mono tracking-wider ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                          ID: {faq.id}
                        </span>
                      </div>

                      <h3 className={`text-sm sm:text-base font-semibold mt-2 flex items-center justify-between sm:justify-start gap-2.5 ${
                        isBarangay ? 'text-[#011025]' : 'text-neutral-900'
                      }`}>
                        <span>{faq.question}</span>
                        {isExpanded ? (
                          <ChevronUp className={`w-4 h-4 shrink-0 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`} />
                        ) : (
                          <ChevronDown className={`w-4 h-4 shrink-0 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`} />
                        )}
                      </h3>

                      <p className={`text-xs leading-relaxed mt-2.5 transition-all ${
                        isExpanded
                          ? isBarangay
                            ? 'bg-[#C2E8FF]/15 p-4 rounded-xl border border-[#7EA0C5]/30 text-[#011025] font-normal shadow-2xs'
                            : 'bg-neutral-50/90 p-4 rounded-xl border border-neutral-200/70 text-neutral-700 font-normal shadow-2xs'
                          : isBarangay
                            ? 'text-[#5482B4] line-clamp-2'
                            : 'text-neutral-600 line-clamp-2'
                      }`}>
                        {faq.answer}
                      </p>

                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
                      <button
                        onClick={() => handleOpenEdit(faq)}
                        className={`p-2 rounded-full cursor-pointer transition-colors shadow-2xs ${
                          isBarangay
                            ? 'border border-[#7EA0C5]/40 bg-white text-[#5482B4] hover:text-[#052659] hover:bg-[#C2E8FF]/30'
                            : 'border border-neutral-200/70 bg-white text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100'
                        }`}
                        title="Edit FAQ"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteFaq(faq.id)}
                        className={`p-2 rounded-full cursor-pointer transition-colors shadow-2xs ${
                          isBarangay
                            ? 'border border-[#7EA0C5]/40 bg-white text-[#7EA0C5] hover:text-[#052659] hover:bg-[#C2E8FF]/30'
                            : 'border border-neutral-200/70 bg-white text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100'
                        }`}
                        title="Delete FAQ"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Add / Edit FAQ */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`bg-white rounded-[24px] max-w-lg w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200 ${
            isBarangay ? 'border border-[#7EA0C5]/40 shadow-[0_8px_30px_rgba(5,38,89,0.12)]' : 'border border-neutral-200/80'
          }`}>
            <div className={`flex items-center justify-between pb-3.5 ${isBarangay ? 'border-b border-[#7EA0C5]/20' : 'border-b border-neutral-100'}`}>
              <h3 className={`font-semibold text-base ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                {editingFaq ? 'Edit Community FAQ' : 'Add Community FAQ'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className={`cursor-pointer p-1 rounded-full transition-colors ${
                  isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveFaq} className="space-y-4 pt-4">
              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                }`}>
                  FAQ Category *
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className={`w-full text-xs font-medium rounded-xl p-2.5 appearance-none focus:outline-hidden shadow-2xs cursor-pointer transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                >
                  {FAQ_CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                }`}>
                  Question *
                </label>
                <input
                  required
                  type="text"
                  value={formQuestion}
                  onChange={(e) => setFormQuestion(e.target.value)}
                  placeholder="e.g. Where can I pick up relief food packs in my barangay?"
                  className={`w-full text-xs font-medium p-2.5 rounded-xl focus:outline-hidden shadow-2xs transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] placeholder-[#7EA0C5] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                }`}>
                  Official Answer *
                </label>
                <textarea
                  required
                  rows={4}
                  value={formAnswer}
                  onChange={(e) => setFormAnswer(e.target.value)}
                  placeholder="Provide clear, concise instructions for Lingayen residents..."
                  className={`w-full text-xs font-medium p-2.5 rounded-xl focus:outline-hidden shadow-2xs transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] placeholder-[#7EA0C5] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                />
              </div>

              <div className={`flex items-center justify-end gap-2 pt-3 ${isBarangay ? 'border-t border-[#7EA0C5]/20' : 'border-t border-neutral-100'}`}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className={`px-4 py-2 text-xs font-medium rounded-full cursor-pointer transition-colors ${
                    isBarangay
                      ? 'text-[#5482B4] hover:bg-[#C2E8FF]/20'
                      : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-xs font-medium text-white rounded-full shadow-xs cursor-pointer transition-colors ${
                    isBarangay
                      ? 'bg-[#052659] hover:bg-[#031c42]'
                      : 'bg-[#18181b] hover:bg-neutral-800'
                  }`}
                >
                  Publish FAQ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
