import {
  AlignLeft, ArrowUpRight, AtSign, Calendar, CheckSquare, Clock, Globe, Hash, IndianRupee, Link2, List, ListChecks, Phone, Star, Type, User,
} from "lucide-react";
import type { AttributeType } from "@/lib/data-model/types";

/** The small icon in a column header or field label that says what kind of value it holds. */
const ICONS: Record<AttributeType, React.ElementType> = {
  text: Type,
  long_text: AlignLeft,
  number: Hash,
  currency: IndianRupee,
  checkbox: CheckSquare,
  date: Calendar,
  timestamp: Clock,
  rating: Star,
  select: List,
  multi_select: ListChecks,
  email: AtSign,
  phone: Phone,
  url: Link2,
  domain: Globe,
  record_ref: ArrowUpRight,
  member: User,
};

export function TypeIcon({ type, className }: { type: AttributeType; className?: string }) {
  const Icon = ICONS[type] ?? Type;
  return <Icon aria-hidden className={className ?? "h-3.5 w-3.5"} />;
}
