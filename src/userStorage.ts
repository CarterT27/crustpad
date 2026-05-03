import { useEffect, useState } from "react";
import type { UserInfo } from "./protocol";

const names = [
  "Anonymous Abel",
  "Anonymous Ada",
  "Anonymous Agnesi",
  "Anonymous Alhazen",
  "Anonymous Ampere",
  "Anonymous Archimedes",
  "Anonymous Aristotle",
  "Anonymous Avicenna",
  "Anonymous Banach",
  "Anonymous Bernoulli",
  "Anonymous Bohr",
  "Anonymous Cantor",
  "Anonymous Cartan",
  "Anonymous Cauchy",
  "Anonymous Curie",
  "Anonymous Darwin",
  "Anonymous Descartes",
  "Anonymous Dirac",
  "Anonymous Emmy",
  "Anonymous Erdos",
  "Anonymous Euclid",
  "Anonymous Euler",
  "Anonymous Faraday",
  "Anonymous Fermi",
  "Anonymous Fibonacci",
  "Anonymous Fourier",
  "Anonymous Galileo",
  "Anonymous Gauss",
  "Anonymous Germain",
  "Anonymous Hamilton",
  "Anonymous Hilbert",
  "Anonymous Hypatia",
  "Anonymous Jacobi",
  "Anonymous Kepler",
  "Anonymous Kovalevsky",
  "Anonymous Lagrange",
  "Anonymous Laplace",
  "Anonymous Leibniz",
  "Anonymous Maxwell",
  "Anonymous Minkowski",
  "Anonymous Mirzakhani",
  "Anonymous Newton",
  "Anonymous Noether",
  "Anonymous Pascal",
  "Anonymous Pasteur",
  "Anonymous Planck",
  "Anonymous Poincare",
  "Anonymous Raman",
  "Anonymous Ramanujan",
  "Anonymous Riemann",
  "Anonymous Salk",
  "Anonymous Schrodinger",
  "Anonymous Tesla",
  "Anonymous Thales",
  "Anonymous Turing",
  "Anonymous Uhlenbeck",
  "Anonymous Volta",
  "Anonymous Weierstrass",
  "Anonymous Wiles",
];

function randomUser(): UserInfo {
  return {
    name: names[Math.floor(Math.random() * names.length)],
    hue: Math.floor(Math.random() * 360),
  };
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseUser(value: string | null): UserInfo | undefined {
  const parsed = parseJson(value);
  if (
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as UserInfo).name === "string" &&
    Number.isSafeInteger((parsed as UserInfo).hue)
  ) {
    return parsed as UserInfo;
  }

  return undefined;
}

function loadStoredUser(): UserInfo {
  const legacyName = parseJson(window.localStorage.getItem("name"));
  const legacyHue = parseJson(window.localStorage.getItem("hue"));
  if (
    typeof legacyName === "string" &&
    legacyName.length > 0 &&
    typeof legacyHue === "number" &&
    Number.isSafeInteger(legacyHue)
  ) {
    return { name: legacyName, hue: legacyHue };
  }

  return parseUser(window.localStorage.getItem("crustpad:user")) ?? randomUser();
}

export function useStoredUser(): [UserInfo, (user: UserInfo) => void] {
  const [user, setUser] = useState<UserInfo>(loadStoredUser);

  useEffect(() => {
    window.localStorage.setItem("crustpad:user", JSON.stringify(user));
    window.localStorage.removeItem("name");
    window.localStorage.removeItem("hue");
  }, [user]);

  return [user, setUser];
}
