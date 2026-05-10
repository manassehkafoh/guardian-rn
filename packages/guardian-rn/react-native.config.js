module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.guardian.rn.GuardianRNPackage;',
      },
      ios: {
        podspecPath: './GuardianRN.podspec',
      },
    },
  },
};
