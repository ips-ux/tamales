import {
  CONTACT_MESSAGE_MAX,
  cleanContactFields,
  firstName,
  formatPhone,
  isEmail,
  phoneHref,
  quantityLabel,
  splitParagraphs,
  validateContact,
  validateSignupEmail
} from "../src/components/publicForm";

describe("splitParagraphs", () => {
  it("starts a new paragraph at a blank line", () => {
    expect(splitParagraphs("One.\n\nTwo.")).toEqual(["One.", "Two."]);
  });

  it("joins single line breaks and ignores extra blank lines", () => {
    expect(splitParagraphs("  One\nstill one.\r\n\r\n \n\nTwo.  \n")).toEqual(["One still one.", "Two."]);
  });

  it("returns no paragraphs for empty text", () => {
    expect(splitParagraphs(" \n\n ")).toEqual([]);
  });
});

describe("phone formats", () => {
  it("writes a US number with hyphens", () => {
    expect(formatPhone("(720) 360-8688")).toBe("720-360-8688");
    expect(formatPhone("+1 720 360 8688")).toBe("720-360-8688");
  });

  it("leaves other values as they are", () => {
    expect(formatPhone(" 555-0186 ")).toBe("555-0186");
  });

  it("builds a tel link", () => {
    expect(phoneHref("720-360-8688")).toBe("tel:+17203608688");
    expect(phoneHref("1 (720) 360-8688")).toBe("tel:+17203608688");
  });
});

describe("quantityLabel", () => {
  it("uses the dozen term for 6 and for full dozens only", () => {
    expect(quantityLabel(6)).toBe("6 (half dozen)");
    expect(quantityLabel(12)).toBe("12 (1 dozen)");
    expect(quantityLabel(24)).toBe("24 (2 dozen)");
    expect(quantityLabel(5)).toBe("5 tamales");
    expect(quantityLabel(18)).toBe("18 tamales");
    expect(quantityLabel(1)).toBe("1 tamale");
  });
});

describe("firstName", () => {
  it("returns the first word of a name", () => {
    expect(firstName("  Jane   Doe ")).toBe("Jane");
    expect(firstName("")).toBe("");
  });
});

describe("email checks", () => {
  it("accepts a complete address and rejects a partial one", () => {
    expect(isEmail("jane@example.com")).toBe(true);
    expect(isEmail("jane@example")).toBe(false);
    expect(isEmail("jane example.com")).toBe(false);
  });

  it("gives 1 instruction for a signup problem", () => {
    expect(validateSignupEmail("  ")).toBe("Enter your email address.");
    expect(validateSignupEmail("jane@")).toBe("Enter a complete email address.");
    expect(validateSignupEmail(" jane@example.com ")).toBe("");
  });
});

describe("validateContact", () => {
  const good = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "",
    message: "Do you have green tamales on Saturday?"
  };

  it("accepts a correct form with no phone", () => {
    expect(validateContact(good)).toEqual([]);
  });

  it("lists each empty required field", () => {
    expect(validateContact({ firstName: " ", lastName: "", email: "", phone: "", message: "" })).toEqual([
      "Enter your first name.",
      "Enter your last name.",
      "Enter your email address.",
      "Enter your message."
    ]);
  });

  it("rejects a short phone number and a long message", () => {
    const errors = validateContact({
      ...good,
      phone: "555-01",
      message: "x".repeat(CONTACT_MESSAGE_MAX + 1)
    });
    expect(errors).toHaveLength(2);
    expect(validateContact({ ...good, message: "x".repeat(CONTACT_MESSAGE_MAX) })).toEqual([]);
  });

  it("trims each field before the send", () => {
    expect(cleanContactFields({ ...good, firstName: " Jane ", message: " Hello. \n" })).toEqual({
      ...good,
      firstName: "Jane",
      message: "Hello."
    });
  });
});
