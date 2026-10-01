"""Whole numbers as English words, for spoken text and for reading Whisper's digits back."""

from __future__ import annotations

import re

_ONES = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
]
_TENS = ["_", "_", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def int_words(n: int) -> str:
    """0..999,999 as words: 22 -> 'twenty-two', 404 -> 'four hundred four'."""
    if n < 0 or n >= 1_000_000:
        raise ValueError(f"out of range: {n}")
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return _TENS[tens] + (f"-{_ONES[ones]}" if ones else "")
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        return f"{_ONES[hundreds]} hundred" + (f" {int_words(rest)}" if rest else "")
    thousands, rest = divmod(n, 1000)
    return f"{int_words(thousands)} thousand" + (f" {int_words(rest)}" if rest else "")


_DIGITS = re.compile(r"\d+")


def digits_to_words(text: str) -> str:
    """Every run of digits as words (for comparing a transcript with the spoken text)."""
    return _DIGITS.sub(lambda m: int_words(int(m.group())) if len(m.group()) <= 6 else m.group(), text)
