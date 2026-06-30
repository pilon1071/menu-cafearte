export interface CloverItem {
  id: string;
  name: string;
  price: number;
  priceType?: string;
  defaultTaxRates?: boolean;
  unitName?: string;
  sku?: string;
  description?: string;
  hidden?: boolean;
  available?: boolean;
  autoManage?: boolean;
  itemCode?: string;
  alternateName?: string;
  categories?: {
    elements: CloverCategory[];
  };
  imageUrl?: string;
  images?: {
    elements: Array<{ id: string; url?: string }>;
  };
  modifierGroups?: {
    elements: Array<{ id: string; name: string }>;
  };
  itemStock?: {
    quantity?: number;
    stockCount?: number;
  };
}

export interface CloverCategory {
  id: string;
  name: string;
  sortOrder?: number;
}

export interface CloverModifier {
  id: string;
  name: string;
  price: number;
  available?: boolean;
}

export interface CloverModifierGroup {
  id: string;
  name: string;
  minRequired?: number;
  maxAllowed?: number;
  modifiers?: {
    elements: CloverModifier[];
  };
}

export interface CloverResponse<T> {
  elements: T[];
  href?: string;
}

export class CloverClient {
  private baseUrl: string;
  private token: string;
  private merchantId: string;

  constructor(token: string, merchantId: string, region: string = "us") {
    this.token = token;
    this.merchantId = merchantId;
    this.baseUrl =
      region === "eu"
        ? "https://api.eu.clover.com"
        : "https://api.clover.com";
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Clover API error ${response.status}: ${response.statusText}\n${body}`
      );
    }

    return response.json() as Promise<T>;
  }

  async getItems(): Promise<CloverItem[]> {
    const path = `/v3/merchants/${this.merchantId}/items?expand=categories,itemStock,images,modifierGroups&filter=hidden=false&limit=1000`;
    const data = await this.request<CloverResponse<CloverItem>>(path);
    return data.elements;
  }

  async getCategories(): Promise<CloverCategory[]> {
    const path = `/v3/merchants/${this.merchantId}/categories?limit=200`;
    const data = await this.request<CloverResponse<CloverCategory>>(path);
    return data.elements;
  }

  async getModifierGroups(): Promise<CloverModifierGroup[]> {
    const path = `/v3/merchants/${this.merchantId}/modifier_groups?expand=modifiers&limit=500`;
    const data = await this.request<CloverResponse<CloverModifierGroup>>(path);
    return data.elements;
  }
}
