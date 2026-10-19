// The slice of the Office Scripts ExcelScript API that BuildSageOEImport.ts uses,
// with the same signatures as Excel for the web, so tsc can type-check it offline.
declare namespace ExcelScript {
  interface Workbook {
    getWorksheets(): Worksheet[];
  }
  interface Worksheet {
    getRange(address?: string): Range;
    getRangeByIndexes(startRow: number, startColumn: number, rowCount: number, columnCount: number): Range;
    getUsedRange(valuesOnly?: boolean): Range;
  }
  interface Range {
    clear(): void;
    getValues(): (string | number | boolean)[][];
    setValues(values: (string | number | boolean)[][]): void;
    setNumberFormatLocal(numberFormatLocal: string): void;
    getRowIndex(): number;
    getColumnIndex(): number;
    getFormat(): RangeFormat;
  }
  interface RangeFormat {
    autofitColumns(): void;
    getFont(): RangeFont;
  }
  interface RangeFont {
    setBold(bold: boolean): void;
  }
}
